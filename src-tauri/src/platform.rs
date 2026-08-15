use crate::{
    domain::{AnalysisProviderKind, CredentialStoreKind, PlatformCapabilities, PlatformKind},
    error::{AtlasError, AtlasResult},
};

pub fn current_capabilities() -> PlatformCapabilities {
    capabilities_for_target(current_platform(), std::env::consts::ARCH)
}

pub fn ensure_provider_supported(provider: AnalysisProviderKind) -> AtlasResult<()> {
    let capabilities = current_capabilities();
    if capabilities.available_providers.contains(&provider) {
        return Ok(());
    }
    Err(unsupported_provider_error(provider, capabilities.platform))
}

pub fn unsupported_provider_error(
    provider: AnalysisProviderKind,
    platform: PlatformKind,
) -> AtlasError {
    AtlasError::Provider(unsupported_provider_message(provider, platform))
}

pub fn unsupported_provider_message(
    provider: AnalysisProviderKind,
    platform: PlatformKind,
) -> String {
    format!(
        "当前 {platform_label} 平台不支持分析 provider `{provider}`",
        platform_label = platform.label(),
        provider = provider.as_str(),
    )
}

fn current_platform() -> PlatformKind {
    #[cfg(target_os = "macos")]
    {
        PlatformKind::Macos
    }
    #[cfg(target_os = "windows")]
    {
        PlatformKind::Windows
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        PlatformKind::Other
    }
}

fn capabilities_for_target(platform: PlatformKind, architecture: &str) -> PlatformCapabilities {
    let credential_store = match platform {
        PlatformKind::Macos => CredentialStoreKind::MacosKeychain,
        PlatformKind::Windows => CredentialStoreKind::WindowsCredentialManager,
        PlatformKind::Other => CredentialStoreKind::SystemKeyring,
    };
    let available_providers = if platform == PlatformKind::Macos && architecture == "aarch64" {
        vec![
            AnalysisProviderKind::CodexCli,
            AnalysisProviderKind::OpenaiApi,
        ]
    } else {
        vec![AnalysisProviderKind::OpenaiApi]
    };
    PlatformCapabilities {
        platform,
        available_providers,
        credential_store,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_is_openai_only_and_uses_credential_manager() {
        let capabilities = capabilities_for_target(PlatformKind::Windows, "x86_64");
        assert_eq!(
            capabilities.available_providers,
            vec![AnalysisProviderKind::OpenaiApi]
        );
        assert_eq!(
            capabilities.credential_store,
            CredentialStoreKind::WindowsCredentialManager
        );
        assert_eq!(
            serde_json::to_value(&capabilities).unwrap(),
            serde_json::json!({
                "platform": "windows",
                "availableProviders": ["openai_api"],
                "credentialStore": "windows_credential_manager"
            })
        );
    }

    #[test]
    fn only_apple_silicon_macos_exposes_codex() {
        let apple_silicon = capabilities_for_target(PlatformKind::Macos, "aarch64");
        assert_eq!(
            apple_silicon.available_providers,
            vec![
                AnalysisProviderKind::CodexCli,
                AnalysisProviderKind::OpenaiApi
            ]
        );
        assert_eq!(
            apple_silicon.credential_store,
            CredentialStoreKind::MacosKeychain
        );

        let intel = capabilities_for_target(PlatformKind::Macos, "x86_64");
        assert_eq!(
            intel.available_providers,
            vec![AnalysisProviderKind::OpenaiApi]
        );
    }

    #[test]
    fn unknown_platform_fails_closed_to_openai() {
        let capabilities = capabilities_for_target(PlatformKind::Other, "riscv64");
        assert_eq!(
            capabilities.available_providers,
            vec![AnalysisProviderKind::OpenaiApi]
        );
        assert_eq!(
            capabilities.credential_store,
            CredentialStoreKind::SystemKeyring
        );
    }
}
