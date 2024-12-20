server:
	uv run fastapi dev app/main.py

scrape:
	uv run python -m scripts.scrape --only=gcp:machine-types
