# Checklist — infrastructure

Agent `ai-workflow:security-infra`. Per class: **Detect** · **Confirm** · **Fix** ·
**Not a finding**. Judge the value that reaches production (tfvars, overlays, prod
values), not the default. Render with `audit.mjs render helm|kustomize`; read config
with `Read` or `audit.mjs show`. Scanner ids (`CKV_*`, `AVD-*`, `DL*`) go in `Rule:`
only when this run's `audit.mjs scan` printed them.

## Cloud IaC

### iac.storage — public object storage · CWE-284, CWE-732 · CIS AWS Foundations · ATT&CK T1530
Detect:
- **AWS (Terraform):** `acl` public-read or public-read-write;
  `aws_s3_bucket_public_access_block` missing or with any of its four flags false; bucket
  policies with `Principal` `*` and Allow but no `aws:SourceVpce`, `aws:PrincipalOrgID`
  or `aws:SourceArn` condition; `object_ownership` not `BucketOwnerEnforced`; website
  buckets.
- **GCS:** `allUsers` or `allAuthenticatedUsers`, `uniform_bucket_level_access = false`,
  `public_access_prevention` not enforced.
- **Azure:** `allow_nested_items_to_be_public` or `allow_blob_public_access` true,
  `container_access_type` blob or container.
- **CFN:** `AccessControl: PublicRead`, no `PublicAccessBlockConfiguration`.
- Snapshots and AMIs shared with all.

Confirm: the bucket and its policy, ACL and access-block resources (separate in AWS
provider 4+); no account-level block overriding it; what the bucket holds (name,
writers).
Fix: access block with all four flags true; `BucketOwnerEnforced`; CloudFront with
origin access control and a bucket policy conditioned on the distribution ARN; GCS
`public_access_prevention` enforced and uniform access.
Not a finding: a static-asset bucket behind OAC with nothing sensitive (LOW if served
directly).

### iac.network — exposure to the internet · CWE-284 · CIS AWS Foundations
Detect:
- `0.0.0.0/0`, `::/0`, `*` or `Internet` in `cidr_blocks`, `ipv6_cidr_blocks`,
  `cidr_ipv4`, `source_ranges`, `source_address_prefix` or `CidrIp`;
- on any of these ports, or on all ports and protocol `-1`:
  - remote access: 22, 3389, 5900, 23;
  - databases and caches: 3306, 5432, 1433, 1521, 6379, 11211, 27017, 9200/9300, 5601;
  - control planes: 2375/2376, 2379/2380, 6443, 10250;
  - other services: 8080/8443/9090/3000, 445, 21;
- `aws_default_security_group` with rules;
- public EKS or GKE endpoints with open `public_access_cidrs`;
- NSG Allow from `*`.

Confirm: attachment → instance, ENI, LB or DB → subnet → route to an internet gateway or
a public IP.
Fix: known CIDRs or security-group references; SSM Session Manager, IAP or Bastion
instead of SSH and RDP; private endpoints; an empty default security group.
Not a finding: 80/443 on a public load balancer; open egress (unless the workload is
highly sensitive); variables overridden in tfvars.

### iac.iam — wildcards, escalation primitives, trust · CWE-269, CWE-250 · CIS AWS Foundations · ATT&CK T1078.004, T1098
Detect, in policy documents (`jsonencode`, `aws_iam_policy_document`, heredoc JSON,
CFN):
- `Action` `*` or `service:*` on `Resource` `*`; `NotAction` with Allow.
- Escalation actions on `*`:
  - `iam:PassRole`, `iam:CreatePolicyVersion`, `iam:SetDefaultPolicyVersion`;
  - `iam:Attach*Policy`, `iam:Put*Policy`;
  - `iam:CreateAccessKey`, `iam:UpdateAssumeRolePolicy`, `iam:CreateLoginProfile`,
    `iam:UpdateLoginProfile`, `iam:AddUserToGroup`;
  - PassRole with a compute-creating action: `lambda:CreateFunction` or
    `UpdateFunctionCode`, `lambda:UpdateFunctionConfiguration`, `ec2:RunInstances`,
    `cloudformation:CreateStack`, `codebuild:CreateProject|StartBuild|UpdateProject`,
    `ecs:RegisterTaskDefinition` with `RunTask` or `UpdateService`,
    `sagemaker:CreateNotebookInstance|CreateTrainingJob|CreateProcessingJob`,
    `datapipeline:CreatePipeline`, `autoscaling:CreateLaunchConfiguration`;
  - `glue:CreateDevEndpoint`, `glue:UpdateDevEndpoint`, `lambda:AddPermission`,
    `ssm:SendCommand`, `ssm:StartSession`, `ec2-instance-connect:SendSSHPublicKey` to
    instances with a stronger role, `sts:AssumeRole`.
- `AdministratorAccess`, `PowerUserAccess` or `IAMFullAccess` on workloads.
- Trust policies with `Principal` `*`, or a foreign account without `sts:ExternalId`;
  trust in `arn:aws:iam::<own account>:root` without a `PrincipalArn` condition (any
  principal in the account with `sts:AssumeRole` gets it).
- Service-principal grants (`Principal.Service`) in role trust or resource policies,
  for services acting for other accounts (logging delivery, CloudTrail, Config, SNS, S3
  notifications, AppSync, API Gateway, EventBridge, Scheduler), without
  `aws:SourceAccount`, `aws:SourceArn` or `aws:SourceOrgID` (confused deputy).
- `aws_iam_access_key` (long-lived keys).
- Log-tampering rights on workloads: `cloudtrail:StopLogging`, `DeleteTrail`,
  `logs:DeleteLogGroup`, `guardduty:DeleteDetector`.
- GCP: `roles/owner`, `roles/editor`, `iam.serviceAccountTokenCreator` or
  `iam.serviceAccountUser` at project level; `google_service_account_key`.
- Azure: Owner or Contributor at subscription scope.

CI federation trust is `cicd.oidc-trust`.
Confirm: which principal gets it and what an attacker controlling that workload gains —
write the escalation path.
Fix: enumerated actions and ARNs; `iam:PassRole` scoped to one role ARN with
`iam:PassedToService`; permission boundaries for roles that create roles; workload
identity instead of keys; an SCP denying log tampering.
Not a finding: read-only actions that need `*` (`ec2:Describe*`); `sts:AssumeRole` on a
specific ARN; service-linked roles; break-glass admin with MFA conditions; `ec2` and
`lambda` execution-role trust without source conditions.

### iac.identity — cloud identity services · CWE-287, CWE-284, CWE-620
Detect: `aws_cognito_identity_pool` with `allow_unauthenticated_identities = true` and
an unauthenticated role holding more than read-only public data;
`aws_cognito_user_pool` with self-signup on an internal pool, mutable `email` without
`auto_verified_attributes`, or `attributes_require_verification_before_update` unset
(an attacker changes email to a victim's and takes the account); custom attributes
like `role` or `tenant` writable by the app client (`write_attributes`); Firebase or
Identity Platform with email enumeration protection off or email-link sign-in to
arbitrary domains.
Confirm: the pool settings and the role or claims they feed.
Fix: no unauthenticated identities unless needed and scoped; verified, immutable or
re-verified email; admin-only writes to privilege attributes; enumeration protection on.
Not a finding: public read-only guest roles over public data.

### iac.dns — dangling records and mail spoofing · CWE-350, CWE-923
Detect: `aws_route53_record`, `google_dns_record_set`, `azurerm_dns_cname_record`,
`cloudflare_record` with CNAME or ALIAS targets on `*.s3-website*`, `*.cloudfront.net`,
`*.azurewebsites.net`, `*.cloudapp.net`, `*.trafficmanager.net`, `*.herokuapp.com`,
`*.netlify.app`, `*.vercel.app`, `*.github.io`, `*.elasticbeanstalk.com`,
`*.blob.core.windows.net`, `*.web.core.windows.net`, `*.azureedge.net`, `*.azurefd.net`,
Fastly, Shopify, Zendesk, Ghost or Webflow targets whose resource is not defined in the
repo; NS records delegating to a zone the repo doesn't define; A records to elastic IPs
released elsewhere; managed zones without SPF, DKIM or DMARC (`p=none` on a sending
domain).
Confirm: the record and the absence of the target resource in any module; note
`verify outside repo` when another repo may own it.
Fix: delete dangling records with the resource; manage both in one stack; SPF `-all`,
DMARC `p=reject` (staged).
Not a finding: targets defined in the same root module.

### iac.shadow-resource — references to cloud resources the repo doesn't own · CWE-668, CWE-494
Detect: `s3://`, `*.s3*.amazonaws.com`, `gs://` and `*.blob.core.windows.net` names in
scripts, Dockerfiles, CI, user_data, Helm values and docs with no matching bucket
resource in the repo; `aws s3 cp|sync` downloads without `--expected-bucket-owner`;
default CDK bootstrap qualifiers (`hnb659fds`); policies granting `s3:GetObject` on name
wildcards (`arn:aws:s3:::cdk-*`) without `aws:ResourceAccount`. Bucket names are global:
a deleted one can be registered by anyone (watchTowr 2025, Aqua 2024).
Confirm: the name is created nowhere in the repo, and what the consumer does with the
object (executes, deploys, stores data); `verify outside repo` when another repo may own
it.
Fix: buckets created in the same stack; `--expected-bucket-owner` /
`ExpectedBucketOwner`; an `aws:ResourceAccount` condition; non-default CDK qualifiers;
checksums on downloads.
Not a finding: well-known vendor buckets read with a pinned checksum.

### iac.encryption — data at rest and in transit · CWE-311, CWE-312 · CIS AWS Foundations
Detect:
- `storage_encrypted` false or absent (RDS, Aurora);
- `encrypted = false` (EBS, EFS, Redshift) without `aws_ebs_encryption_by_default`;
- SQS or SNS without SSE/KMS;
- ElastiCache `at_rest_encryption_enabled` or `transit_encryption_enabled` false;
- OpenSearch `encrypt_at_rest` or `node_to_node_encryption` false;
- `aws_kms_key` without `enable_key_rotation`;
- key policies with `Principal` `*` and `kms:*`;
- no CMEK where policy requires one.

Confirm: account defaults (EBS default encryption; S3 SSE-S3 default since 2023) and the
data classification (names, writers).
Fix: encryption flags with a rotated customer-managed key whose policy names specific
roles; TLS flags on caches and search.
Not a finding: S3 and DynamoDB default encryption unless a CMK is required.

### iac.datastore — reachable databases and weak store config · CWE-1188, CWE-798, CWE-284
Detect:
- `publicly_accessible = true`; DB subnet groups in public subnets;
- Cloud SQL `ipv4_enabled` with authorized networks `0.0.0.0/0`, or SSL not required;
- Azure `public_network_access_enabled = true`, or a 0.0.0.0–255.255.255.255 firewall
  rule;
- a literal `password` or `master_password` (`audit.mjs secrets` flags it) instead of
  `manage_master_user_password` or `random_password`;
- `backup_retention_period = 0`;
- `deletion_protection = false` with `skip_final_snapshot = true` on prod;
- Redis, Mongo or Elasticsearch without auth in compose or manifests (no `requirepass`,
  `xpack.security.enabled=false`);
- SaaS data platforms (Snowflake UNC5537, 2024): `snowflake_user` with `password` and no
  `rsa_public_key`, no `snowflake_network_policy` attachment, no MFA authentication
  policy, or `ACCOUNTADMIN` for service users; `mongodbatlas_project_ip_access_list`
  with `0.0.0.0/0`; long-lived `databricks_token`; dbt `profiles.yml` or Snowflake
  `connections.toml` with a password (`secret.tracked`).

Confirm: subnet → route → gateway; the password is a literal, not a sensitive variable
sourced elsewhere.
Fix: private subnets, a security group from the app's only; a managed master password;
TLS required; retention ≥ 7 days, deletion protection, a final snapshot; auth on every
store.
Not a finding: sandbox-account stacks (note them); compose services bound to
`127.0.0.1`; SSO-only human users behind a network policy.

### iac.logging — audit and detection · CWE-778 · CIS AWS Foundations · ATT&CK T1562.008 · A09:2025
Detect:
- no multi-region CloudTrail with `enable_log_file_validation`, or a trail bucket
  without Object Lock;
- no GuardDuty, Config or Security Hub;
- no VPC flow logs;
- LB, CloudFront, API Gateway or WAF access logs off;
- EKS `enabled_cluster_log_types` without `audit`; empty RDS log exports;
- GCP audit config without DATA_READ/DATA_WRITE;
- log retention 0 or unset.

Confirm: org or landing-zone modules in the repo; absent → `verify outside repo`.
Fix: an org trail with validation, KMS and a locked archive bucket; detectors on;
access and audit logs; retention per policy; alarms on root use, IAM changes and trail
stops.
Not a finding: app repos relying on a landing zone — HARDENING.

### iac.state — Terraform state, pins, provisioners · CWE-312, CWE-829, CWE-78
Detect:
- tracked `*.tfstate*`, `*.tfplan`, `.terraform/` (`inventory` `SECRET-FILE`), or
  `terraform.tfvars` with secret hits;
- `backend "local"` in shared code; S3 backends without `encrypt = true` or locking;
- unpinned code: module git sources without `?ref=` to a tag or SHA, or with
  `ref=main`; registry modules without `version`; `required_providers` without
  constraints; `.terraform.lock.hcl` missing;
- outputs exposing secrets without `sensitive = true`; secrets as variable defaults or
  inline provider credentials;
- `local-exec`, `remote-exec` or `external` with interpolated variables.

Confirm: tracked state is a finding by path alone — never open it;
`audit.mjs secrets --history` shows whether state was ever committed.
Fix: remove it and rotate everything it held; an encrypted, locked, versioned remote
backend; pinned modules and providers; a committed lock file; `sensitive = true`.
Not a finding: `*.tfvars.example` placeholders.

### iac.compute — metadata, instances, serverless · CWE-918, CWE-312 · ATT&CK T1552.005
Detect:
- **Instances:** `aws_instance` or launch templates without `http_tokens = "required"`
  (IMDSv1); `http_put_response_hop_limit` above 1 on container hosts; no
  `aws_ec2_instance_metadata_defaults`; `associate_public_ip_address = true`;
  `user_data` with secrets or `curl … | bash`; public keys baked in — tracked
  `authorized_keys`, cloud-init `ssh_authorized_keys`, Ansible `authorized_key`,
  `aws_key_pair`, `metadata.ssh-keys` (persistent access, ATT&CK T1098.004; a new key in
  a diff is a LEAD for its owner).
- **AWS serverless:**
  - `aws_lambda_function_url` with `authorization_type` NONE and no in-code auth;
  - `aws_lambda_permission` with principal `*` and no `source_arn`;
  - API Gateway `authorization` NONE on non-public routes;
  - Lambda or ECS env with literal secrets instead of `secrets`/`valueFrom`;
  - functions with admin or `s3:*` on `*`.
- **Other clouds:** Cloud Run or Functions with `allUsers` invoker or
  `--allow-unauthenticated`; Azure Functions anonymous; `serverless.yml` http events
  without an authorizer, or `iamRoleStatements` with `Action: '*'`; GKE without
  workload identity.

Confirm: for anonymous endpoints, read the handler for a signature or JWT check
(present → downgrade).
Fix: IMDSv2 required with hop limit 1 (IRSA or pod identity for containers); no public
IPs, SSM instead; secrets fetched at runtime; IAM or an authorizer on function URLs;
scoped permissions; per-function roles.
Not a finding: public webhook receivers with HMAC verification in code.

### iac.messaging — queues, topics, event buses · CWE-284
Detect: `aws_sqs_queue_policy`, `aws_sns_topic_policy` and EventBridge bus policies
with `Principal` `*` and no conditions; Pub/Sub `allUsers`; Kafka or RabbitMQ without
auth in manifests.
Confirm: who can publish, and what the consumer does with messages
(`async.consumers`).
Fix: least-privilege publish rights with source conditions.
Not a finding: account-internal principals with conditions.

### iac.gitops — GitOps, config management and PaaS manifests · CWE-284, CWE-829, CWE-798
Detect:
- **Argo CD:** Applications in `project: default`, AppProjects with `*` destinations
  or `clusterResourceWhitelist` `*`, auto-sync from branches untrusted users can push.
- **Flux:** `GitRepository` or `HelmRepository` on unpinned refs or with insecure
  transport.
- **Ansible:** `validate_certs: no`, plaintext vars instead of Vault, `become: true` on
  `hosts: all`, `shell` with templated input.
- **Packer:** provisioners with `curl | sh`.
- **Nomad:** jobs with `privileged` or the `raw_exec` driver.
- **Vault:** HCL policies with `path "*"` or `sudo` capabilities.
- **PaaS manifests:** secret hits in `wrangler.toml` `vars`, `fly.toml` `env`,
  `render.yaml` `envVars`, GAE `app.yaml` `env_variables`, Heroku `app.json`; services
  marked public.

Confirm: the manifest line and what it deploys or grants.
Fix: dedicated projects with explicit destinations; sync only from protected branches
or signed tags; pinned sources; Ansible Vault and `validate_certs: yes`; least-privilege
Vault paths; platform secret stores.
Not a finding: example manifests no deploy path references.

## Kubernetes

### k8s.pod-security — privileged and root workloads · CWE-250, CWE-269 · ATT&CK T1611 · Pod Security Standards
Detect (in rendered output):
- **Host access:** `privileged: true`; `hostPID`, `hostIPC`, `hostNetwork`; `hostPort`;
  `hostPath` (`/`, `/var/run/docker.sock`, the containerd socket, `/proc`, `/etc`,
  `/var/lib/kubelet`).
- **Privilege:** `allowPrivilegeEscalation` not false; `capabilities.add` with
  SYS_ADMIN, NET_ADMIN, SYS_PTRACE, NET_RAW or ALL; no `drop: [ALL]`; `runAsUser: 0` or
  no `runAsNonRoot`; `readOnlyRootFilesystem` false; no
  `seccompProfile: RuntimeDefault`.
- **Images and resources:** `:latest` or tags without digests; no `resources.limits`.
- **Identity:** `automountServiceAccountToken` not false on pods that don't call the
  API; the default service account.
- Namespaces without `pod-security.kubernetes.io/enforce`.

Confirm: values overrides applied; exposure through a Service or Ingress (privileged
and exposed = CRITICAL).
Fix: `runAsNonRoot: true`, numeric `runAsUser`, `allowPrivilegeEscalation: false`,
`readOnlyRootFilesystem: true`, `capabilities.drop: [ALL]`, `seccompProfile.type:
RuntimeDefault`; no host namespaces or hostPath; token automount off; limits; the
`restricted` namespace label; an admission policy in Enforce mode.
Not a finding: CNI, CSI and log-agent DaemonSets that need host access (LOW with a
justification).

### k8s.rbac — RBAC escalation · CWE-269 · CIS Kubernetes
Detect:
- wildcard `verbs`, `resources` or `apiGroups`;
- dangerous grants: `secrets` get/list/watch; `pods/exec`, `pods/attach`, `nodes/proxy`;
  create on `serviceaccounts/token`; `escalate`, `bind`, `impersonate`;
- create on roles, bindings, `mutatingwebhookconfigurations` or `persistentvolumes`;
- ClusterRoleBindings to `cluster-admin` for app service accounts, or for
  `system:authenticated`, `system:anonymous` or `system:unauthenticated`;
- IRSA or workload-identity trust with `system:serviceaccount:*:*`;
- create, update or patch on `pods`, `deployments`, `daemonsets`, `statefulsets`,
  `jobs`, `cronjobs` or `replicasets` — equal to every service account in the
  namespace; `certificatesigningrequests/approval` with signer approve;
- `aws-auth` `mapRoles`/`mapUsers` with `system:masters`; EKS access entries with
  `AmazonEKSClusterAdminPolicy` for CI or workload roles.

Confirm: binding → service account → pods using it → what a compromise of that pod
reaches.
Fix: namespaced Roles with explicit verbs, resources and `resourceNames`; no secret
list/watch; exact service-account subjects in cloud trust.
Not a finding: operators matching upstream RBAC (flag drift only).

### k8s.network — NetworkPolicy, Services, Ingress · CWE-284
Detect:
- no NetworkPolicy, or no default deny (`podSelector: {}` with Ingress and Egress) per
  namespace;
- no egress deny to `169.254.169.254/32`;
- LoadBalancer or NodePort without `loadBalancerSourceRanges` or an internal
  annotation;
- Ingress without TLS, or with `configuration-snippet`/`server-snippet` annotations;
- admin UIs exposed without auth: Argo CD, Grafana, Kibana, Prometheus, Dashboard,
  Jupyter, Airflow, Flower, RabbitMQ, Consul, Vault;
- Dashboard `--enable-skip-login`;
- admission webhooks reachable beyond the API server (no NetworkPolicy on the webhook
  port — IngressNightmare, 2025); `failurePolicy: Ignore` on security webhooks; Kyverno
  `validationFailureAction: Audit` or Gatekeeper `enforcementAction: dryrun` in prod
  overlays; `allow-snippet-annotations: "true"`. Controller versions go to
  `deps.vulnerable`.

Confirm: the exposure path (a CNI without policy support is still a finding).
Fix: default deny per namespace plus explicit allows; metadata egress denied; source
ranges or internal LBs; TLS; oauth2-proxy in front of admin UIs; snippet annotations
off.
Not a finding: a public app ingress with TLS.

### k8s.control-plane — cluster API and kubelet configuration · CWE-306, CWE-284, CWE-311 · CIS Kubernetes
Detect: `ClusterConfiguration`, `KubeletConfiguration`, `kube-apiserver` static pods
and k3s `config.yaml` with `anonymous-auth: "?true|authentication.anonymous.enabled: true|authorization-mode=AlwaysAllow|mode: AlwaysAllow|readOnlyPort: 10255|profiling=true|insecure-port`;
an `EncryptionConfiguration` with `identity` first, or none; no `--audit-policy-file`;
managed clusters: EKS `endpoint_public_access = true` with `public_access_cidrs` missing
or `0.0.0.0/0`, GKE `enable_legacy_abac = true` or no `master_authorized_networks_config`,
AKS without `api_server_access_profile` authorized ranges.
Confirm: the config line, and whether the API endpoint is internet-reachable per IaC.
Fix: anonymous off; `Node,RBAC` authorization; `readOnlyPort: 0`; KMS or `aescbc` first
in encryption; an audit policy; a private endpoint or authorized CIDRs; legacy ABAC off.
Not a finding: kind or minikube configs used only by local tests (LOW).

### k8s.secrets — secrets in manifests and values · CWE-312, CWE-798
Detect:
- committed `kind: Secret` with `data` or `stringData` (base64 is not encryption; read
  only through `audit.mjs show`);
- ConfigMap keys or env `value:` literals that `audit.mjs secrets` flags;
- non-empty secret fields in `values*.yaml`;
- `helm --set` secrets in scripts;
- no SealedSecrets, External Secrets or SOPS;
- EKS without `encryption_config`.

Confirm: real (not `placeholder`) per `audit.mjs secrets`; key name and `path:line`
only.
Fix: External Secrets, CSI Secrets Store, SealedSecrets or SOPS; mounted as files;
envelope encryption; rotate committed values.
Not a finding: kind or minikube manifests with placeholders.

## Containers

### container.dockerfile — image build · CWE-250, CWE-494, CWE-538 · CIS Docker
Detect:
- **Runs as root:** no `USER`, or a final `USER` of root or 0; `sudo`; `chmod 777`.
- **Unpinned base:** `FROM` with `:latest`, no tag, or no `@sha256`.
- **Secrets in the image:** `ARG`/`ENV` named like secrets
  (`TOKEN|SECRET|PASSWORD|KEY|NPM_TOKEN|GITHUB_TOKEN|AWS_SECRET`) used in `RUN` (they
  persist in history); `COPY . .` without a `.dockerignore` covering `.env`, `.git`,
  `*.pem`, `id_rsa`, `.aws`, `.npmrc`; `COPY` of credential files; no
  `RUN --mount=type=secret` where secrets are needed.
- **Untrusted downloads:** `curl`/`wget` piped to a shell; `ADD https://` without a
  checksum; `--insecure`, `-k`, `--no-check-certificate`, `strict-ssl false`,
  `--trusted-host`.
- **Attack surface:** `EXPOSE 22` or sshd; a single stage shipping build tools;
  `WORKDIR /proc/self/fd` (runc fd leak, CVE-2024-21626).

An upstream base-image tag alone is not a finding: name a line in this Dockerfile.

Confirm: the line and, for secrets, where the ARG is consumed and whether the final
stage keeps it.
Fix: a numeric non-root `USER 10001`; `FROM image:tag@sha256:<digest>` with
Renovate/Dependabot; `RUN --mount=type=secret,id=…`; a full `.dockerignore`; pinned
downloads checked with `sha256sum -c`; a distroless or minimal final stage.
Not a finding: root in a discarded builder stage; non-secret build args (`VERSION`,
`COMMIT_SHA`).

### container.compose — compose and local runtime · CWE-250, CWE-284
Detect: `privileged: true`, `network_mode: host`, `pid: host`, `/var/run/docker.sock`
mounts, `cap_add`, DB or cache ports published on all interfaces (`5432:5432` instead
of `127.0.0.1:5432:5432`), secret hits in `environment`, a Docker daemon on
`tcp://0.0.0.0:2375`.
Confirm: whether the file is used beyond local development (deploy scripts, CI).
Fix: bind to `127.0.0.1`; no socket mounts; env files outside git; secrets from the
runtime.
Not a finding: dev-only files — LOW at most, still listed.

## Edge and network

### edge.tls — transport security · CWE-319, CWE-326
Detect: `aws_lb_listener` HTTP without a redirect; `ssl_policy` older than
`ELBSecurityPolicy-TLS13-1-2-2021-06`; CloudFront `viewer_protocol_policy` allow-all or
`minimum_protocol_version` below TLSv1.2_2021; nginx `ssl_protocols` with TLSv1, 1.1 or
SSLv3, weak `ssl_ciphers`, no HSTS.
Confirm: the internet-facing listener or server block.
Fix: HTTPS only with a 301; TLS 1.2+ (a 1.3 policy); HSTS of at least one year.
Not a finding: internal listeners behind a mesh in STRICT mTLS.

### edge.exposure — debug, metrics and admin endpoints exposed · CWE-489, CWE-200, CWE-215
Detect:
- proxy routes or port mappings exposing on public interfaces: `/metrics`, `/debug`,
  `/actuator`, `/swagger`, `/graphiql`, pprof, the Jupyter, Grafana, Kibana, Flower,
  Consul or Vault UIs, Docker or kubelet APIs;
- AI serving without auth (ShadowRay, Ollama exposure, LLMjacking, 2024): Ray dashboard
  and GCS (`8265`, `6379`, `--dashboard-host=0.0.0.0`), Ollama (`11434`,
  `OLLAMA_HOST=0.0.0.0`), vLLM or TGI without `--api-key`, Gradio `share=True` or
  `server_name="0.0.0.0"`, ComfyUI (`8188`), MLflow (`5000`) published or behind a
  LoadBalancer or Ingress with no auth proxy;
- `autoindex on`; `server_tokens on`;
- no WAF on a public ALB, CloudFront or API Gateway, or no edge rate-based rule.

App-level debug flags are `api.inventory` and `leak.errors`.
Confirm: bound or routed publicly in the production config.
Fix: bind to localhost or an internal port behind policy; disable in production; a WAF
with managed rules and a rate-based rule.
Not a finding: `/metrics` on an internal port scraped in-cluster behind a NetworkPolicy.

### edge.proxy — proxy trust, normalisation, caches · CWE-444, CWE-348, CWE-524, CWE-436
Detect:
- **Header trust:** `trust proxy: true` or wide trusted-proxy lists;
  `USE_X_FORWARDED_HOST`; authz, rate limits or audit keyed on
  `X-Forwarded-For`/`X-Real-IP`; `proxy_set_header Host $http_host`.
- **Normalisation gaps:** proxy-level path blocks (`location /admin { deny all; }`) that
  the app normalises differently (`/admin/`, `/%61dmin`, `;`); nginx `alias` under a
  `location` missing its trailing slash; a static root at the repo root (serving
  `.git`, `.env`).
- **Caching:**
  - cache rules caching `/api/*`, or keys ignoring `Authorization`/`Cookie`;
  - extension rules (`*.css`) matching `/account/settings.css` (cache deception);
  - prefix or static-directory rules (`/static/*`, `/share/*`) where the origin decodes
    `%2F`, `..` or accepts delimiters (`;`, `%23`, `%3F`, `%00`), so a dynamic route sits
    under the cached prefix; session and token endpoints without
    `Cache-Control: no-store` (ChatGPT wildcard cache deception, 2024);
  - unkeyed headers (`X-Forwarded-Host`, `X-Original-URL`) reflected into responses
    (cache poisoning);
  - framework-internal request headers forwarded from the public edge to a self-hosted
    framework (`x-middleware-*`, `x-now-*`, `x-invoke-*`, `x-nextjs-*`) — Next.js cache
    poisoning and middleware bypass (2024–2025).
- **Desync:** HTTP/1.0 upstreams or mixed HTTP/2 downgrade on outdated proxies
  (versions from Dockerfiles — static evidence only, never probe); lenient parsers
  (`insecureHTTPParser: true`, `--insecure-http-parser`); `Upgrade` forwarded on
  non-WebSocket routes (h2c); CONNECT allowed at the edge. LIKELY at most unless two
  components with different parsers are evidenced.
- **Apache:** `RewriteRule` substituting `$1` into filesystem paths or `[P]` proxies
  with user segments; handlers by extension; ACLs on pre-rewrite paths (Confusion
  Attacks, 2024).

File only with an attacker-controlled input on the path (a request header, URL or
body); an env value or a proxy version alone is not one (exclusions §7).
Confirm: the config line and the app behaviour it diverges from.
Fix: trust exactly the known hops; client IP from the edge-set header; authz in the app,
not the proxy; `alias` and `location` slashes matching; serve only the build directory;
`Cache-Control: private, no-store` on authenticated responses; strict routing without
extension tolerance; cache keys including every reflected header.
Not a finding: no shared cache in front; a single managed edge that normalises (still
check header trust).
