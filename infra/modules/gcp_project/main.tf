resource "google_project" "gcp_project" {
  name            = var.project_name
  project_id      = var.project_id
  org_id          = "5511490855"
  billing_account = "011071-509348-EB6D37"
}

resource "google_project_service" "compute_api" {
  project = google_project.gcp_project.project_id
  service = "compute.googleapis.com"

  disable_on_destroy = false
}

resource "google_project_service" "servicenetworking_api" {
  project = google_project.gcp_project.project_id
  service = "servicenetworking.googleapis.com"

  disable_on_destroy = false
}

resource "google_compute_global_address" "private_ip_address" {
  name          = "private-ip-address"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = data.google_compute_network.default.id
  project       = google_project.gcp_project.project_id

  depends_on = [google_project_service.servicenetworking_api]
}

resource "google_service_networking_connection" "default" {
  network                 = data.google_compute_network.default.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_address.name]
}

data "google_compute_network" "default" {
  name    = "default"
  project = google_project.gcp_project.project_id

  depends_on = [google_project_service.compute_api]
}
