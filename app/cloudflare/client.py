from app.db.models import UserType


class CloudflareClient:
    def put_user_type(self, user_id: str, user_type: UserType):
        pass

    def remote_user_type(self, user_id: str):
        pass


def get_cloudflare_client() -> CloudflareClient:
    return CloudflareClient()
