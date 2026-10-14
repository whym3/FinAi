from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    database_url: str = 'postgresql+psycopg://pravah:pravah@localhost:5432/pravah'
    app_secret_key: str = ''  # base64 of 32 random bytes; encrypts OAuth tokens and API keys
    public_url: str = 'http://localhost:5173'  # where the browser reaches the app (OAuth redirects land here)
    storage_dir: str = './storage'
    google_client_id: str = ''
    google_client_secret: str = ''
    ms_client_id: str = ''
    ms_client_secret: str = ''
    openai_api_key: str = ''
    anthropic_api_key: str = ''
    gemini_api_key: str = ''
    poll_seconds: int = 60
    run_background: bool = True  # mailbox pollers + extraction worker inside the API process


settings = Settings()
