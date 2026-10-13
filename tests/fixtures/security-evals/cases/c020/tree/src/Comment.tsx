import type { Comment as C } from "./api"

export function Comment({ comment }: { comment: C }) {
  return (
    <article>
      <h4>{comment.author}</h4>
      <div className="body" dangerouslySetInnerHTML={{ __html: comment.body }} />
    </article>
  )
}
