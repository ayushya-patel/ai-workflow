resource "aws_iam_role" "web" {
  name               = "web"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy" "web" {
  role = aws_iam_role.web.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "s3:*", Resource = "*" }]
  })
}

resource "aws_iam_instance_profile" "web" {
  role = aws_iam_role.web.name
}

resource "aws_instance" "web" {
  ami                  = var.ami
  instance_type        = var.instance_type
  iam_instance_profile = aws_iam_instance_profile.web.name
  user_data            = file("${path.module}/start.sh")
}
