use keyring::Entry;

use crate::error::{AtlasError, AtlasResult};

const SERVICE: &str = "com.visiontale.dialogueatlas";
const ACCOUNT: &str = "openai-api-key";

#[derive(Debug, Clone, Default)]
pub struct KeyStore;

impl KeyStore {
    fn entry(&self) -> AtlasResult<Entry> {
        Entry::new(SERVICE, ACCOUNT).map_err(|error| AtlasError::Keychain(error.to_string()))
    }

    pub fn set(&self, api_key: &str) -> AtlasResult<()> {
        let api_key = api_key.trim();
        if api_key.is_empty() {
            return Err(AtlasError::InvalidInput("API key 不能为空".into()));
        }
        self.entry()?
            .set_password(api_key)
            .map_err(|error| AtlasError::Keychain(error.to_string()))
    }

    pub fn get(&self) -> AtlasResult<String> {
        self.entry()?
            .get_password()
            .map_err(|error| AtlasError::Keychain(error.to_string()))
    }

    pub fn configured(&self) -> bool {
        self.get().is_ok_and(|value| !value.trim().is_empty())
    }
}
