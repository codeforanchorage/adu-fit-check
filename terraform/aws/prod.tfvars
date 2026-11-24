lambda_name = "adu-fit-check-survey-prod"
stage_name  = "prod"

# The live page, and the local test server (npm start).
allowed_origins = [
  "https://www.brendanbabb.com",
  "https://brendanbabb.com",
  "http://127.0.0.1:8000",
]

# The fleet's existing alarm topic, so alarms reach the same inbox.
alarm_sns_topic_arn = "arn:aws:sns:us-west-2:420839047325:anchorage-gis-mcp-prod-alarms"
