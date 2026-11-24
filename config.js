// config.js: where the page finds the survey reader (Phase 4, see lambda/ and terraform/aws/).
//
// url   the address "Read survey with AI" posts the survey image to. Leave it empty and the
//       button never appears; everything else on the page works without it.
// key   an API Gateway key. It is PUBLIC BY DESIGN and is not a secret: its only job is to
//       tie each request to a usage plan with a daily quota, which caps how many paid model
//       calls can be made in a day. The model API key is a different thing. It lives only on
//       the server, in an encrypted parameter, and must never appear in this repository.
//
// After a deploy, both values come from:
//   terraform -chdir=terraform/aws output -raw read_survey_url
//   terraform -chdir=terraform/aws output -raw page_key
export const SURVEY_READER={url:"https://61ifxlzls9.execute-api.us-west-2.amazonaws.com/prod/read-survey",key:"CzOCMnaDoEqvZ5z7nGwn5bOlhAeyZMt8sYwP79d4"};
