use std::sync::{Mutex, MutexGuard};

#[cfg(not(target_os = "windows"))]
use keyring::Entry;
#[cfg(target_os = "windows")]
use keyring_core::{Entry, api::CredentialStoreApi};

use crate::error::{AtlasError, AtlasResult};

const SERVICE: &str = "com.visiontale.dialogueatlas";
const ACCOUNT: &str = "openai-api-key";
#[cfg(any(target_os = "windows", test))]
const WINDOWS_LOCAL_PERSISTENCE: &str = "Local";

static CREDENTIAL_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Default)]
pub struct KeyStore;

impl KeyStore {
    #[cfg(not(target_os = "windows"))]
    fn entry(&self) -> AtlasResult<Entry> {
        Entry::new(SERVICE, ACCOUNT).map_err(|error| AtlasError::Keychain(error.to_string()))
    }

    #[cfg(target_os = "windows")]
    fn entry(&self) -> AtlasResult<Entry> {
        let store = windows_native_keyring_store::Store::new()
            .map_err(|error| AtlasError::Keychain(error.to_string()))?;
        let modifiers = windows_local_persistence_modifiers();
        let account = windows_credential_account()?;
        store
            .build(SERVICE, &account, Some(&modifiers))
            .map_err(|error| AtlasError::Keychain(error.to_string()))
    }

    pub fn set(&self, api_key: &str) -> AtlasResult<()> {
        let api_key = api_key.trim();
        if api_key.is_empty() {
            return Err(AtlasError::InvalidInput("API key 不能为空".into()));
        }
        let _guard = credential_guard()?;
        let entry = self.entry()?;
        entry
            .set_password(api_key)
            .map_err(|error| AtlasError::Keychain(error.to_string()))?;
        fail_closed_after_write(verify_windows_local_persistence(&entry), || {
            let _ = entry.delete_credential();
        })
    }

    pub fn get(&self) -> AtlasResult<String> {
        let _guard = credential_guard()?;
        let entry = self.entry()?;
        verify_windows_local_persistence(&entry)?;
        entry
            .get_password()
            .map_err(|error| AtlasError::Keychain(error.to_string()))
    }

    /// Reserved for an explicit future "clear local credential" command.
    #[allow(dead_code)]
    pub fn delete(&self) -> AtlasResult<()> {
        let _guard = credential_guard()?;
        self.entry()?
            .delete_credential()
            .map_err(|error| AtlasError::Keychain(error.to_string()))
    }

    pub fn configured(&self) -> bool {
        self.get().is_ok_and(|value| !value.trim().is_empty())
    }
}

fn credential_guard() -> AtlasResult<MutexGuard<'static, ()>> {
    CREDENTIAL_LOCK
        .lock()
        .map_err(|_| AtlasError::Keychain("credential store operation lock is poisoned".into()))
}

fn fail_closed_after_write(
    verification: AtlasResult<()>,
    cleanup: impl FnOnce(),
) -> AtlasResult<()> {
    match verification {
        Ok(()) => Ok(()),
        Err(error) => {
            cleanup();
            Err(error)
        }
    }
}

#[cfg(target_os = "windows")]
fn windows_credential_account() -> AtlasResult<String> {
    #[cfg(debug_assertions)]
    if let Ok(account) = std::env::var("DIALOGUE_ATLAS_CREDENTIAL_ACCOUNT") {
        validate_windows_debug_credential_account(&account)?;
        return Ok(account);
    }
    Ok(ACCOUNT.into())
}

#[cfg(any(all(target_os = "windows", debug_assertions), test))]
fn validate_windows_debug_credential_account(account: &str) -> AtlasResult<()> {
    let suffix = account
        .strip_prefix("dialogue-atlas-smoke-")
        .ok_or_else(|| {
            AtlasError::InvalidInput(
                "Windows debug credential account must use the smoke prefix".into(),
            )
        })?;
    if suffix.is_empty()
        || account.len() > 96
        || !suffix
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err(AtlasError::InvalidInput(
            "Windows debug credential account contains unsupported characters".into(),
        ));
    }
    Ok(())
}

#[cfg(any(target_os = "windows", test))]
fn windows_local_persistence_modifiers() -> std::collections::HashMap<&'static str, &'static str> {
    std::collections::HashMap::from([("persistence", WINDOWS_LOCAL_PERSISTENCE)])
}

#[cfg(target_os = "windows")]
fn verify_windows_local_persistence(entry: &Entry) -> AtlasResult<()> {
    let attributes = entry
        .get_attributes()
        .map_err(|error| AtlasError::Keychain(error.to_string()))?;
    validate_windows_local_persistence(attributes.get("persistence").map(String::as_str))
}

#[cfg(not(target_os = "windows"))]
fn verify_windows_local_persistence(_entry: &Entry) -> AtlasResult<()> {
    Ok(())
}

#[cfg(any(target_os = "windows", test))]
fn validate_windows_local_persistence(persistence: Option<&str>) -> AtlasResult<()> {
    match persistence {
        Some(WINDOWS_LOCAL_PERSISTENCE) => Ok(()),
        Some(actual) => Err(AtlasError::Keychain(format!(
            "Windows credential persistence is {actual}; expected {WINDOWS_LOCAL_PERSISTENCE}"
        ))),
        None => Err(AtlasError::Keychain(
            "Windows credential persistence attribute is missing".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keychain_windows_modifier_requests_local_persistence() {
        let modifiers = windows_local_persistence_modifiers();
        assert_eq!(
            modifiers.get("persistence"),
            Some(&WINDOWS_LOCAL_PERSISTENCE)
        );
    }

    #[test]
    fn keychain_windows_persistence_validation_fails_closed() {
        assert!(validate_windows_local_persistence(Some("Local")).is_ok());

        for persistence in [None, Some("Enterprise"), Some("Session"), Some("local")] {
            assert!(validate_windows_local_persistence(persistence).is_err());
        }
    }

    #[test]
    fn keychain_failed_post_write_validation_triggers_cleanup() {
        let cleaned = std::cell::Cell::new(false);
        let error = fail_closed_after_write(
            Err(AtlasError::Keychain("wrong persistence".into())),
            || cleaned.set(true),
        )
        .unwrap_err();

        assert!(cleaned.get());
        assert!(matches!(error, AtlasError::Keychain(_)));
    }

    #[test]
    fn windows_debug_credential_account_is_isolated_and_constrained() {
        assert!(
            validate_windows_debug_credential_account("dialogue-atlas-smoke-0123456789abcdef")
                .is_ok()
        );
        for invalid in [
            ACCOUNT,
            "dialogue-atlas-smoke-",
            "dialogue-atlas-smoke-value.with.dot",
            "dialogue-atlas-smoke-value/with/slash",
        ] {
            assert!(validate_windows_debug_credential_account(invalid).is_err());
        }
    }

    #[test]
    fn keychain_rejects_blank_key_before_store_access() {
        let error = KeyStore.set("  \n\t ").unwrap_err();
        assert!(matches!(error, AtlasError::InvalidInput(_)));
    }

    #[test]
    fn keychain_delete_api_remains_available_for_explicit_cleanup() {
        let delete: fn(&KeyStore) -> AtlasResult<()> = KeyStore::delete;
        let _ = delete;
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "writes and removes a temporary Windows Credential Manager entry"]
    fn installed_windows_credential_manager_local_round_trip_smoke() {
        let store = windows_native_keyring_store::Store::new().unwrap();
        let account = format!("dialogue-atlas-windows-smoke-{}", uuid::Uuid::new_v4());
        let modifiers = windows_local_persistence_modifiers();
        let entry = store.build(SERVICE, &account, Some(&modifiers)).unwrap();
        let temporary_secret = "dialogue-atlas-temporary-local-credential";

        let result = (|| -> AtlasResult<(String, String)> {
            entry
                .set_password(temporary_secret)
                .map_err(|error| AtlasError::Keychain(error.to_string()))?;
            let persistence = entry
                .get_attributes()
                .map_err(|error| AtlasError::Keychain(error.to_string()))?
                .get("persistence")
                .cloned()
                .ok_or_else(|| AtlasError::Keychain("missing persistence attribute".into()))?;
            let stored = entry
                .get_password()
                .map_err(|error| AtlasError::Keychain(error.to_string()))?;
            Ok((persistence, stored))
        })();
        let cleanup = entry.delete_credential();
        let (persistence, stored) = result.unwrap();
        cleanup.expect("temporary Windows credential must be removed");

        assert_eq!(persistence, WINDOWS_LOCAL_PERSISTENCE);
        assert_eq!(stored, temporary_secret);
    }
}
