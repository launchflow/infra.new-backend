import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    db_url: str = os.environ.get("DB_URL", "sqlite:///./test.db")
    propel_auth_webhook_secret: str = os.environ["PROPEL_AUTH_WEBHOOK_SECRET"]
    propel_auth_url: str = os.environ.get(
        "PROPEL_AUTH_URL", "https://98861797.propelauthtest.com"
    )
    propel_auth_api_key: str = os.environ["PROPEL_AUTH_API_KEY"]
    cloudflare_api_token: str = os.environ["CLOUDFLARE_API_TOKEN"]
    stripe_api_key: str = os.environ["STRIPE_API_KEY"]
    stripe_product_id: str = os.environ["STRIPE_PRODUCT_ID"]
    stripe_price_id: str = os.environ["STRIPE_PRICE_ID"]
    # TODO: need to figure out something for this
    stripe_redirect_url: str = "http://localhost:8000"
    stripe_webhook_signing_secret: str = os.environ["STRIPE_WEBHOOK_SIGNING_SECRET"]
    instance_connection_name = os.environ.get("INSTANCE_CONNECTION_NAME")
    db_password = os.environ.get("DB_PASSWORD")
    db_user = os.environ.get("DB_USER")
    db_name = os.environ.get("DB_NAME")
    db_root_cert = os.environ.get("DB_ROOT_CERT")
    db_cert = os.environ.get("DB_CERT")
    db_key = os.environ.get("DB_KEY")
    db_private_ip = os.environ.get("DB_PRIVATE_IP", False)


settings = Settings()
