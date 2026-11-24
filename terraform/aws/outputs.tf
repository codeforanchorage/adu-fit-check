output "read_survey_url" {
  description = "Address the page posts a survey image to"
  value       = "${aws_api_gateway_stage.prod.invoke_url}/read-survey"
}

output "page_key" {
  description = "The API Gateway key the page sends. Public by design: it only attaches the daily quota."
  value       = aws_api_gateway_api_key.page.value
  sensitive   = true
}

output "lambda_name" {
  value = aws_lambda_function.reader.function_name
}
