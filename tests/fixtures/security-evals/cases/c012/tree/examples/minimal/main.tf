# Copy-paste starting point for a scratch account. Not referenced by infra/.
resource "aws_instance" "scratch" {
  ami           = "ami-0abc1234def567890"
  instance_type = "t3.micro"
}
