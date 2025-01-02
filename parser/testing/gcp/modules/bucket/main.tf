variable "storage_class" {
  description = "The storage class of the bucket"
  type        = string
  default     = "STANDARD"
}

resource "google_storage_bucket" "bucket" {
  name          = "my-bucket"
  location      = "US"
  force_destroy = true
  storage_class = var.storage_class
}
