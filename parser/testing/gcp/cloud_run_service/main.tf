resource "google_cloud_run_v2_service" "default" {
  name                = "cloudrun-service"
  location            = "us-central1"
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"
    }
  }
}

# tier 2 location
resource "google_cloud_run_v2_service" "tier_2" {
  name                = "cloudrun-service"
  location            = "africa-south1"
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"
    }
  }
}