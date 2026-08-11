use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use reqwest::{Client, StatusCode};
use serde_json::{Value, json};
use tokio::time::sleep;
#[cfg(any(debug_assertions, test))]
use url::Url;

use crate::error::{AtlasError, AtlasResult};

const OPENAI_API_BASE_URL: &str = "https://api.openai.com/v1";

#[derive(Debug, Clone)]
pub struct OpenAiClient {
    client: Client,
    base_url: String,
}

#[derive(Debug, Clone)]
pub struct StructuredResult {
    pub value: Value,
    pub input_tokens: i64,
    pub output_tokens: i64,
}

impl OpenAiClient {
    pub fn new() -> AtlasResult<Self> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(|error| AtlasError::OpenAi(error.to_string()))?;
        let base_url = configured_base_url()?;
        Ok(Self { client, base_url })
    }

    pub async fn test_key(&self, api_key: &str) -> AtlasResult<()> {
        let response = self
            .client
            .get(format!("{}/models", self.base_url))
            .bearer_auth(api_key)
            .send()
            .await
            .map_err(|error| AtlasError::OpenAi(error.to_string()))?;
        if response.status().is_success() {
            return Ok(());
        }
        Err(api_error(response).await)
    }

    pub async fn structured(
        &self,
        api_key: &str,
        model: &str,
        schema_name: &str,
        schema: Value,
        system: &str,
        input: Value,
        cancelled: &Arc<AtomicBool>,
    ) -> AtlasResult<StructuredResult> {
        let body = build_structured_request(model, schema_name, schema, system, input);
        let request = self
            .client
            .post(format!("{}/responses", self.base_url))
            .bearer_auth(api_key)
            .json(&body)
            .send();
        tokio::pin!(request);
        let response = tokio::select! {
            result = &mut request => result
                .map_err(|error| AtlasError::OpenAi(error.to_string()))?,
            _ = wait_for_cancellation(cancelled) => return Err(AtlasError::Cancelled),
        };
        let status = response.status();
        let body = response.bytes();
        tokio::pin!(body);
        let body = tokio::select! {
            result = &mut body => result
                .map_err(|error| AtlasError::OpenAi(error.to_string()))?,
            _ = wait_for_cancellation(cancelled) => return Err(AtlasError::Cancelled),
        };
        if !status.is_success() {
            return Err(api_error_body(status, &body));
        }
        let response: Value = serde_json::from_slice(&body)
            .map_err(|error| AtlasError::OpenAi(format!("invalid response JSON: {error}")))?;
        let text = extract_output_text(&response).ok_or_else(|| {
            AtlasError::OpenAi("response did not contain an output_text JSON payload".into())
        })?;
        let value = serde_json::from_str(text)
            .map_err(|error| AtlasError::OpenAi(format!("invalid structured output: {error}")))?;
        Ok(StructuredResult {
            value,
            input_tokens: response
                .pointer("/usage/input_tokens")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            output_tokens: response
                .pointer("/usage/output_tokens")
                .and_then(Value::as_i64)
                .unwrap_or(0),
        })
    }
}

fn configured_base_url() -> AtlasResult<String> {
    #[cfg(debug_assertions)]
    if let Ok(value) = std::env::var("OPENAI_BASE_URL") {
        return validate_debug_loopback_base_url(&value);
    }
    Ok(OPENAI_API_BASE_URL.into())
}

#[cfg(any(debug_assertions, test))]
fn validate_debug_loopback_base_url(value: &str) -> AtlasResult<String> {
    let parsed = Url::parse(value.trim()).map_err(|_| {
        AtlasError::InvalidInput(
            "debug OPENAI_BASE_URL 必须是 http://127.0.0.1:<port>/v1 或 http://localhost:<port>/v1"
                .into(),
        )
    })?;
    let local_host = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"));
    let valid = parsed.scheme() == "http"
        && local_host
        && parsed.port().is_some()
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.path().trim_end_matches('/') == "/v1"
        && parsed.query().is_none()
        && parsed.fragment().is_none();
    if !valid {
        return Err(AtlasError::InvalidInput(
            "debug OPENAI_BASE_URL 只允许带显式端口的本机 loopback /v1 地址".into(),
        ));
    }
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

async fn wait_for_cancellation(cancelled: &Arc<AtomicBool>) {
    while !cancelled.load(Ordering::Relaxed) {
        sleep(Duration::from_millis(25)).await;
    }
}

pub fn build_structured_request(
    model: &str,
    schema_name: &str,
    schema: Value,
    system: &str,
    input: Value,
) -> Value {
    json!({
        "model": model,
        "store": false,
        "background": false,
        "input": [
            {
                "role": "system",
                "content": [{"type": "input_text", "text": system}]
            },
            {
                "role": "user",
                "content": [{"type": "input_text", "text": input.to_string()}]
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": schema_name,
                "strict": true,
                "schema": schema
            }
        }
    })
}

fn extract_output_text(response: &Value) -> Option<&str> {
    response
        .get("output")?
        .as_array()?
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("message"))
        .flat_map(|item| {
            item.get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .find(|item| item.get("type").and_then(Value::as_str) == Some("output_text"))
        .and_then(|item| item.get("text"))
        .and_then(Value::as_str)
}

async fn api_error(response: reqwest::Response) -> AtlasError {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    api_error_body(status, body.as_bytes())
}

fn api_error_body(status: StatusCode, body: &[u8]) -> AtlasError {
    let body = String::from_utf8_lossy(body);
    let message = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| short_body(status, &body));
    AtlasError::OpenAi(format!("{}: {message}", status.as_u16()))
}

fn short_body(status: StatusCode, body: &str) -> String {
    let compact: String = body.chars().take(300).collect();
    if compact.is_empty() {
        status
            .canonical_reason()
            .unwrap_or("request failed")
            .to_string()
    } else {
        compact
    }
}

#[cfg(test)]
mod tests {
    use std::{net::TcpListener, thread, time::Instant};

    use super::*;
    use crate::domain::DIALOGUE_ACTS;
    use crate::schemas::{modes_schema, relations_schema, segmentation_schema};

    #[test]
    fn structured_requests_cannot_store_or_run_in_background() {
        let request = build_structured_request(
            "gpt-5-mini",
            "test",
            json!({"type":"object", "properties":{}, "additionalProperties":false}),
            "system",
            json!({"visible":"only"}),
        );
        assert_eq!(request["store"], false);
        assert_eq!(request["background"], false);
        assert_eq!(request["text"]["format"]["strict"], true);
        assert_eq!(request["text"]["format"]["type"], "json_schema");
        let encoded = request.to_string();
        assert!(encoded.contains("visible"));
        assert!(!encoded.contains("reasoning"));
    }

    #[tokio::test]
    async fn in_flight_responses_request_observes_cancellation() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let cancelled = Arc::new(AtomicBool::new(false));
        let release_server = Arc::new(AtomicBool::new(false));
        let server_release = release_server.clone();
        let server = thread::spawn(move || {
            let (_stream, _) = listener.accept().unwrap();
            while !server_release.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(10));
            }
        });
        let client = OpenAiClient {
            client: Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap(),
            base_url: format!("http://{address}"),
        };
        let trigger = cancelled.clone();
        tokio::spawn(async move {
            sleep(Duration::from_millis(100)).await;
            trigger.store(true, Ordering::Relaxed);
        });
        let started = Instant::now();
        let error = client
            .structured(
                "test-key",
                "gpt-test",
                "test_schema",
                json!({"type":"object", "properties":{}, "additionalProperties":false}),
                "system",
                json!({"visible":"only"}),
                &cancelled,
            )
            .await
            .unwrap_err();
        release_server.store(true, Ordering::Relaxed);
        server.join().unwrap();
        assert!(matches!(error, AtlasError::Cancelled));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn strict_requests_do_not_send_unsupported_unique_items_keyword() {
        for (name, schema) in [
            ("segments", segmentation_schema()),
            ("relations", relations_schema()),
            ("modes", modes_schema()),
        ] {
            let request = build_structured_request(
                "gpt-5-mini",
                name,
                schema,
                "system",
                json!({"visible": "only"}),
            );
            assert!(!request.to_string().contains("uniqueItems"));
        }
    }

    #[test]
    fn segmentation_schema_uses_the_shared_complete_dialogue_act_codebook() {
        let schema = segmentation_schema();
        let values = schema
            .pointer("/properties/units/items/properties/acts/items/enum")
            .and_then(Value::as_array)
            .unwrap();
        assert_eq!(values.len(), DIALOGUE_ACTS.len());
        for required in ["证据", "假设检验", "反例", "撤回"] {
            assert!(values.iter().any(|value| value == required));
        }
    }

    #[test]
    fn debug_base_url_accepts_only_explicit_loopback_v1_endpoints() {
        for valid in ["http://127.0.0.1:41234/v1", "http://localhost:41234/v1/"] {
            assert!(validate_debug_loopback_base_url(valid).is_ok());
        }
        for invalid in [
            "https://api.openai.com/v1",
            "http://example.com:41234/v1",
            "http://127.0.0.1/v1",
            "http://user:secret@127.0.0.1:41234/v1",
            "http://127.0.0.1:41234/v2",
            "http://127.0.0.1:41234/v1?redirect=1",
        ] {
            assert!(validate_debug_loopback_base_url(invalid).is_err());
        }
    }
}
