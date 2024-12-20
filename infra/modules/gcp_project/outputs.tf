output "project_id" {
  value = google_project.gcp_project.project_id
}

output "default_network" {
  value = data.google_compute_network.default.self_link
}
