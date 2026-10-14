from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    database_url: str = 'postgresql+psycopg://pravah:pravah@localhost:5432/pravah'
    app_secret_key: str = ''  # base64 of 32 random bytes; encrypts OAuth tokens, SAP passwords and TOTP secrets
    public_url: str = 'http://localhost:5173'  # the address users open; OAuth redirects and emailed links use it
    storage_dir: str = './storage'
    session_hours: int = 12
    # shortcut: two-factor sign-in is off for now; set REQUIRE_MFA=true before real client data goes in.
    require_mfa: bool = False
    google_client_id: str = ''
    google_client_secret: str = ''
    ms_client_id: str = ''
    ms_client_secret: str = ''
    # Claude reads every document. One key for the deployment, never shown in the UI.
    anthropic_api_key: str = ''
    anthropic_model: str = 'claude-sonnet-5-5'
    # Outgoing email for invites and password resets. Without it the admin copies the links by hand.
    smtp_host: str = ''
    smtp_port: int = 587
    smtp_user: str = ''
    smtp_password: str = ''
    smtp_from: str = 'Pravah <no-reply@example.com>'
    poll_seconds: int = 60
    run_background: bool = True
    max_upload_mb: int = 50

    @property
    def secure_cookies(self) -> bool:
        return self.public_url.startswith('https://')


settings = Settings()
