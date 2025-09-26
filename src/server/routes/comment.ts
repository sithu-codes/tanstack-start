import { zValidator } from "@hono/zod-validator";
import { and, asc, countDistinct, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { User } from "lucia";
import z from "zod";

import { createCommentSchema, paginationSchema } from "@/shared/schemas";
import type {
  Comment,
  PaginatedResponse,
  SuccessResponse
} from "@/shared/types";

import type { Context } from "../context";
import { db } from "../db";
import { commentTable, commentUpvoteTable, postTable } from "../db/tables";
import { loggedIn } from "../middlewares/logged-in";
import { getISOFormatDateQuery } from "../utils";

export const commentRoute = new Hono<Context>()
  .post(
    "/:id",
    loggedIn,
    zValidator("param", z.object({ id: z.coerce.number() })),
    zValidator("form", createCommentSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { content } = c.req.valid("form");
      const user = c.get("user") as User;

      const [comment] = await db.transaction(async (tx) => {
        const [parentComment] = await tx
          .select({
            id: commentTable.id,
            postId: commentTable.postId,
            depth: commentTable.depth
          })
          .from(commentTable)
          .where(eq(commentTable.id, id))
          .limit(1);

        if (!parentComment) {
          throw new HTTPException(404, { message: "Comment not found" });
        }

        const postId = parentComment.postId;

        const [updateParentComment] = await tx
          .update(commentTable)
          .set({
            commentCount: sql`${commentTable.commentCount} + 1`
          })
          .where(eq(commentTable.id, parentComment.id))
          .returning({ commentCount: commentTable.commentCount });

        const [updatedPost] = await tx
          .update(postTable)
          .set({
            commentCount: sql`${postTable.commentCount} + 1`
          })
          .where(eq(postTable.id, parentComment.postId))
          .returning({ commentCount: postTable.commentCount });

        if (!updateParentComment || !updatedPost) {
          throw new HTTPException(404, { message: "Error creating comment" });
        }

        return await tx
          .insert(commentTable)
          .values({
            content,
            userId: user.id,
            postId,
            parentCommentId: parentComment.id,
            depth: parentComment.depth + 1
          })
          .returning({
            id: commentTable.id,
            userId: commentTable.userId,
            postId: commentTable.postId,
            content: commentTable.content,
            points: commentTable.points,
            depth: commentTable.depth,
            parentCommentId: commentTable.parentCommentId,
            createdAt: getISOFormatDateQuery(commentTable.createdAt),
            commentCount: commentTable.commentCount
          });
      });

      return c.json<SuccessResponse<Comment>>({
        success: true,
        message: "Comment created",
        data: {
          ...comment,
          childComments: [],
          commentUpvotes: [],
          author: {
            username: user.username,
            id: user.id
          }
        } as Comment
      });
    }
  )
  .post(
    "/:id/upvote",
    loggedIn,
    zValidator("param", z.object({ id: z.number() })),
    async (c) => {
      const { id } = c.req.valid("param");
      const user = c.get("user") as User;

      let pointsChange: -1 | 1 = 1;

      const points = await db.transaction(async (tx) => {
        const [existingUpvote] = await tx
          .select()
          .from(commentUpvoteTable)
          .where(
            and(
              eq(commentUpvoteTable.commentId, id),
              eq(commentUpvoteTable.userId, user.id)
            )
          )
          .limit(1);

        pointsChange = existingUpvote ? -1 : 1;

        const [updated] = await tx
          .update(commentTable)
          .set({ points: sql`${commentTable.points} + ${pointsChange}` })
          .where(eq(commentTable.id, id))
          .returning({ points: commentTable.points });

        if (!updated) {
          throw new HTTPException(404, { message: "Post not found" });
        }

        if (existingUpvote) {
          await tx
            .delete(commentUpvoteTable)
            .where(eq(commentUpvoteTable.id, existingUpvote.id));
        } else {
          await tx
            .insert(commentUpvoteTable)
            .values({ commentId: id, userId: user.id });
        }

        return updated.points;
      });

      return c.json<
        SuccessResponse<{ count: number; commentUpvotes: { userId: string }[] }>
      >(
        {
          success: true,
          message: "Comment updated",
          data: {
            count: points,
            commentUpvotes: pointsChange === 1 ? [{ userId: user.id }] : []
          }
        },
        200
      );
    }
  )
  .get(
    "/:id/comments",
    zValidator("param", z.object({ id: z.number() })),
    zValidator("query", paginationSchema),
    async (c) => {
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const { limit, page, sortBy, orderBy } = c.req.valid("query");

      const offset = (page - 1) * limit;

      const sortByColumn =
        sortBy === "points" ? commentTable.points : commentTable.createdAt;
      const sortOrder =
        orderBy === "desc" ? desc(sortByColumn) : asc(sortByColumn);

      const [count] = await db
        .select({ count: countDistinct(commentTable.id) })
        .from(commentTable)
        .where(eq(commentTable.parentCommentId, id));

      const comments = await db.query.comment.findMany({
        where: and(eq(commentTable.parentCommentId, id)),
        orderBy: sortOrder,
        limit,
        offset,
        with: {
          author: {
            columns: {
              username: true,
              id: true
            }
          },
          commentUpvotes: {
            columns: { userId: true },
            where: eq(commentUpvoteTable.userId, user?.id ?? ""),
            limit: 1
          }
        },
        extras: {
          createdAt: getISOFormatDateQuery(commentTable.createdAt).as(
            "createdAt"
          )
        }
      });

      return c.json<PaginatedResponse<Comment[]>>(
        {
          success: true,
          message: "Comments fetched",
          data: comments as Comment[],
          pagination: {
            page,
            totalPages: Math.ceil(count.count / limit) as number
          }
        },
        200
      );
    }
  );
