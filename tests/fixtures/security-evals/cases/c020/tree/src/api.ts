export type Comment = { id: number; author: string; body: string }

// comments are written by any signed-in user and stored as entered
export const listComments = (postId: number) => fetch(`/api/posts/${postId}/comments`).then((r) => r.json())
