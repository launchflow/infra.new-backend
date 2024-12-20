from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select
from svix.webhooks import Webhook
import json
from propelauth_fastapi import User as PropelUser
import stripe

from app import settings
from app.cloudflare import CloudflareClient, get_cloudflare_client
from app.db.dependencies import get_db_session
from app.db.models import User, UserType
from app.propel.auth import auth

router = APIRouter(prefix="/integrations", tags=["integrations"])

propel_wh = Webhook(settings.propel_auth_webhook_secret)
stripe.api_key = settings.stripe_api_key


@router.post("/stripe/webhook")
async def stripe_webhook(
    request: Request,
    db: Session = Depends(get_db_session),
):
    sig_header = request.headers["stripe-signature"]
    payload = await request.body()

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.stripe_webhook_signing_secret
        )
    except ValueError as e:
        raise e
    if event.type == "checkout.session.completed":
        # The customer completed signing up for a subscription
        session = event["data"]["object"]
        user_id = session["client_reference_id"]
        user = db.get(User, user_id)
        if user is None:
            raise HTTPException(status_code=404, detail=f"User not found: {user_id}")
        subscription = stripe.Subscription.retrieve(session["subscription"])
        for line_item in subscription["items"]["data"]:
            if line_item["price"]["id"] == settings.stripe_price_id:
                user.user_type = UserType.PRO
                user.stripe_customer_id = subscription["customer"]
                db.commit()
                break
    elif event.type == "customer.subscription.deleted":
        # The customer canceled their subscription
        subscription = event["data"]["object"]
        customer = subscription["customer"]
        stmt = select(User).where(User.stripe_customer_id == customer)
        user = db.exec(stmt).first()
        if user is None:
            raise HTTPException(
                status_code=404,
                detail=f"User not found for stripe customer: {customer}",
            )
        for line_item in subscription["items"]["data"]:
            if line_item["price"]["id"] == settings.stripe_price_id:
                user.user_type = UserType.FREE
                db.commit()
                break
    elif event.type == "invoice.payment_failed":
        # The payment failed for an invoice
        customer = event["data"]["customer"]
        raise HTTPException(
            status_code=400, detail=f"Payment failed for customer: {customer}"
        )

    return {"message": "Stripe Webhook Received"}


@router.get("/stripe/checkout")
async def checkout(
    user: PropelUser = Depends(auth.require_user),
    db: Session = Depends(get_db_session),
):
    db_user = db.get(User, user.user_id)
    if db_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if db_user.user_type != UserType.FREE:
        raise HTTPException(status_code=400, detail="User already upgraded")

    customer_email = None
    customer = None
    if db_user.stripe_customer_id is not None:
        customer = db_user.stripe_customer_id
    else:
        customer_email = user.email

    checkout_session = stripe.checkout.Session.create(
        line_items=[
            {
                "price": settings.stripe_price_id,
                "quantity": 1,
            }
        ],
        payment_method_types=["card"],
        client_reference_id=db_user.id,
        mode="subscription",
        success_url=f"{settings.stripe_redirect_url}/billing",
        cancel_url=settings.stripe_redirect_url,
        customer=customer,  # type: ignore
        customer_email=customer_email,  # type: ignore
        allow_promotion_codes=True,
    )
    return {"url": checkout_session.url}


@router.post("/propel/webhook")
async def propel_webhook(
    request: Request,
    db: Session = Depends(get_db_session),
    cf_client: CloudflareClient = Depends(get_cloudflare_client),
):
    payload = await request.body()
    headers = dict(request.headers)
    propel_wh.verify(payload, headers)
    json_payload = json.loads(payload.decode("utf-8"))
    event_type = json_payload["event_type"]
    if event_type == "user.created":
        user = User(
            id=json_payload["user_id"],
            stripe_customer_id=None,
            user_type=UserType.FREE,
        )
        db.add(user)
        db.commit()
        cf_client.put_user_type(user.id, user.user_type)
    elif event_type == "user.deleted":
        user = db.get(User, json_payload["user_id"])
        if user:
            db.delete(user)
            db.commit()
            cf_client.remote_user_type(user.id)
    return {"message": "Propel Webhook Received"}
