terraform {
  backend "gcs" {
    bucket = "development-tofu-state"
    prefix = "infra-new/"
  }
}
