terraform {
  backend "gcs" {
    bucket = "production-tofu-state"
    prefix = "infra-new/"
  }
}
