## Propel Auth Get Access Token

```bash
curl --location --request POST '{AUTH_URL}/api/backend/v1/access_token' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer {PROPELAUTH_API_KEY}' \
--data '{
    "user_id": "{USER_ID}",
    "duration_in_minutes": 1440
}'
```

## Connect to cloud sql
