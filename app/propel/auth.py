from propelauth_fastapi import init_auth

from app import settings

auth = init_auth(settings.propel_auth_url, settings.propel_auth_api_key)
