from dataclasses import dataclass
import typer
from typing import Callable, List
import asyncio

# Import your scrapers here
from .scrapers import (
    aws_bulk,
    aws_spot,
    azure_retail,
    gcp_catalog,
    gcp_machine_types,
    ibm_kubernetes,
    ibm_catalog,
)

app = typer.Typer()


@dataclass
class ScraperConfig:
    vendor: str
    source: str
    scraper_func: Callable


# Define scraper configurations
Scrapers = {
    "aws": {
        "bulk": aws_bulk.scrape,
        "spot": aws_spot.scrape,
    },
    "azure": {
        "retail": azure_retail.scrape,
    },
    "gcp": {
        "catalog": gcp_catalog.scrape,
        "machine-types": gcp_machine_types.scrape,
    },
    "ibm": {
        "kubernetes": ibm_kubernetes.scrape,
        "catalog": ibm_catalog.scrape,
    },
}


@app.command()
def run(
    only: List[str] = typer.Option(
        None,
        help="Comma-separated list of scrapers to run (e.g., aws:bulk,aws:spot,azure:retail)",
    ),
):
    """
    Run data scraping from cloud vendors.
    """
    scraper_configs = []

    for vendor, vendor_scrapers in Scrapers.items():
        for source, scraper_func in vendor_scrapers.items():
            if not only or f"{vendor}:{source}" in only:
                scraper_configs.append(
                    ScraperConfig(
                        vendor=vendor,
                        source=source,
                        scraper_func=scraper_func,
                    )
                )

    success = asyncio.run(run_scrapers(scraper_configs))
    if not success:
        raise typer.Exit(code=1)


async def run_scrapers(scraper_configs: List[ScraperConfig]) -> bool:
    success = True

    for scraper_config in scraper_configs:
        print(
            f"Running update function for {scraper_config.vendor}:{scraper_config.source}"
        )
        try:
            await scraper_config.scraper_func()
        except Exception as err:
            print(
                f"Error in {scraper_config.vendor}:{scraper_config.source}: {str(err)}"
            )
            success = False

    return success


if __name__ == "__main__":
    app()
