use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use serde_json::Value;

use crate::{
    codex_cli::CodexCliProvider,
    domain::AnalysisProviderKind,
    error::{AtlasError, AtlasResult},
    openai::{OpenAiClient, StructuredResult},
};

#[derive(Debug, Clone)]
pub enum AnalysisProvider {
    CodexCli(CodexCliProvider),
    OpenaiApi {
        client: OpenAiClient,
        api_key: String,
        model: String,
    },
}

impl AnalysisProvider {
    pub fn kind(&self) -> AnalysisProviderKind {
        match self {
            Self::CodexCli(_) => AnalysisProviderKind::CodexCli,
            Self::OpenaiApi { .. } => AnalysisProviderKind::OpenaiApi,
        }
    }

    pub fn model(&self) -> &str {
        match self {
            Self::CodexCli(_) => crate::domain::CODEX_CLI_MODEL,
            Self::OpenaiApi { model, .. } => model,
        }
    }

    pub fn provider_version(&self) -> Option<&str> {
        match self {
            Self::CodexCli(provider) => Some(provider.version()),
            Self::OpenaiApi { .. } => None,
        }
    }

    pub fn credential_mode(&self) -> &'static str {
        match self {
            Self::CodexCli(_) => "chatgpt_login",
            Self::OpenaiApi { .. } => "api_key",
        }
    }

    pub async fn structured(
        &self,
        schema_name: &str,
        schema: Value,
        system: &str,
        input: Value,
        cancelled: &Arc<AtomicBool>,
    ) -> AtlasResult<StructuredResult> {
        if cancelled.load(Ordering::Relaxed) {
            return Err(AtlasError::Cancelled);
        }
        let result = match self {
            Self::CodexCli(provider) => {
                provider
                    .structured(schema_name, schema, system, input, cancelled)
                    .await
            }
            Self::OpenaiApi {
                client,
                api_key,
                model,
            } => {
                client
                    .structured(
                        api_key,
                        model,
                        schema_name,
                        schema,
                        system,
                        input,
                        cancelled,
                    )
                    .await
            }
        }?;
        if cancelled.load(Ordering::Relaxed) {
            return Err(AtlasError::Cancelled);
        }
        Ok(result)
    }
}
