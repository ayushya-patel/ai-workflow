resource "aws_route53_record" "usercontent" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "usercontent.example.com"
  type    = "CNAME"
  ttl     = 300
  records = [aws_cloudfront_distribution.uploads.domain_name]
}
