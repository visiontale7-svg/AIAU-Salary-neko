use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AtlasError {
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("database migration error: {0}")]
    Migration(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("keychain error: {0}")]
    Keychain(String),
    #[error("OpenAI request error: {0}")]
    OpenAi(String),
    #[error("analysis provider error: {0}")]
    Provider(String),
    #[error("analysis provider timed out")]
    ProviderTimeout,
    #[error("analysis cancelled")]
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
}

impl From<AtlasError> for CommandError {
    fn from(value: AtlasError) -> Self {
        let code = match value {
            AtlasError::InvalidInput(_) => "INVALID_INPUT",
            AtlasError::NotFound(_) => "NOT_FOUND",
            AtlasError::Database(_) => "DATABASE_ERROR",
            AtlasError::Migration(_) => "DATABASE_ERROR",
            AtlasError::Io(_) => "IO_ERROR",
            AtlasError::Json(_) => "JSON_ERROR",
            AtlasError::Keychain(_) => "KEYCHAIN_ERROR",
            AtlasError::OpenAi(_) => "OPENAI_ERROR",
            AtlasError::Provider(_) => "PROVIDER_ERROR",
            AtlasError::ProviderTimeout => "PROVIDER_TIMEOUT",
            AtlasError::Cancelled => "CANCELLED",
        };
        Self {
            code,
            message: value.to_string(),
        }
    }
}

pub type AtlasResult<T> = Result<T, AtlasError>;
pub type CommandResult<T> = Result<T, CommandError>;
