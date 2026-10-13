import DOMPurify from "dompurify"

export function Bio({ html }: { html: string }) {
  return <section dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
}
