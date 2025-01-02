resource "google_compute_disk" "with_size" {
  name  = "test-disk"
  type  = "pd-ssd"
  zone  = "us-central1-a"
  image = "debian-11-bullseye-v20220719"
  labels = {
    environment = "dev"
  }
  size = 10
}

resource "google_compute_disk" "only_image" {
  name  = "test-disk"
  type  = "pd-ssd"
  zone  = "us-central1-a"
  image = "debian-11-bullseye-v20220719"
  labels = {
    environment = "dev"
  }
}

resource "google_compute_disk" "from_snapshot" {
  name     = "test-disk-from-snapshot"
  type     = "pd-ssd"
  zone     = "us-central1-a"
  snapshot = "snapshot-id"
  labels = {
    environment = "dev"
  }
}
