resource "google_cloud_run_v2_job" "default" {
  name                = "cloudrun-job"
  location            = "us-central1"
  deletion_protection = false

  template {
    template {
      containers {
        image = "us-docker.pkg.dev/cloudrun/container/job"
      }
    }
  }
}
