import { zValidator } from "@hono/zod-validator";
import { and, asc, countDistinct, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { User } from "lucia";
import z from "zod";

import {
  createCommentSchema,
  createPostSchema,
  paginationSchema
} from "@/shared/schemas";
import type {
  Comment,
  PaginatedResponse,
  Post,
  SuccessResponse
} from "@/shared/types";

import type { Context } from "../context";
import { db } from "../db";
import {
  commentTable,
  commentUpvoteTable,
  postTable,
  postUpvoteTable,
  userTable
} from "../db/tables";
import { loggedIn } from "../middlewares/logged-in";
import { getISOFormatDateQuery } from "../utils";

export const postRoute = new Hono<Context>()
  .post("/", loggedIn, zValidator("form", createPostSchema), async (c) => {
    const { title, url, content } = c.req.valid("form");
    const user = c.get("user") as User;

    const [post] = await db
      .insert(postTable)
      .values({ title, url, content, userId: user.id })
      .returning({ id: postTable.id });

    return c.json<SuccessResponse<{ postId: number }>>(
      {
        success: true,
        message: "Post created",
        data: { postId: post.id }
      },
      201
    );
  })
  .get("/", zValidator("query", paginationSchema), async (c) => {
    const { limit, page, sortBy, orderBy, author, site } = c.req.valid("query");
    const user = c.get("user");

    const offset = (page - 1) * limit;

    const sortByColumn =
      sortBy === "points" ? postTable.points : postTable.createdAt;
    const sortOrder =
      orderBy === "desc" ? desc(sortByColumn) : asc(sortByColumn);

    const [count] = await db
      .select({ count: countDistinct(postTable.id) })
      .from(postTable)
      .where(
        and(
          author ? eq(postTable.userId, author) : undefined,
          site ? eq(postTable.url, site) : undefined
        )
      );

    const postsQuery = db
      .select({
        id: postTable.id,
        title: postTable.title,
        url: postTable.url,
        points: postTable.points,
        createdAt: getISOFormatDateQuery(postTable.createdAt),
        commentCount: postTable.commentCount,
        author: {
          username: userTable.username,
          id: userTable.id
        },
        isUpvoted: user
          ? sql<boolean>`CASE WHEN ${postUpvoteTable.userId} IS NOT NULL THEN true ELSE false END`
          : sql<boolean>`false`
      })
      .from(postTable)
      .leftJoin(userTable, eq(postTable.userId, userTable.id))
      .orderBy(sortOrder)
      .limit(offset)
      .where(
        and(
          author ? eq(postTable.userId, author) : undefined,
          site ? eq(postTable.url, site) : undefined
        )
      );

    if (user) {
      postsQuery.leftJoin(
        postUpvoteTable,
        and(
          eq(postUpvoteTable.postId, postTable.id),
          eq(postUpvoteTable.userId, user.id)
        )
      );
    }

    const posts = await postsQuery;

    return c.json<PaginatedResponse<Post[]>>(
      {
        data: posts as Post[],
        success: true,
        message: "Posts fetched",
        pagination: {
          page,
          totalPages: Math.ceil(count.count / limit) as number
        }
      },
      200
    );
  })
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
          .from(postUpvoteTable)
          .where(
            and(
              eq(postUpvoteTable.postId, id),
              eq(postUpvoteTable.userId, user.id)
            )
          )
          .limit(1);

        pointsChange = existingUpvote ? -1 : 1;

        const [updated] = await tx
          .update(postTable)
          .set({ points: sql`${postTable.points} + ${pointsChange}` })
          .where(eq(postTable.id, id))
          .returning({ points: postTable.points });

        if (!updated) {
          throw new HTTPException(404, { message: "Post not found" });
        }

        if (existingUpvote) {
          await tx
            .delete(postUpvoteTable)
            .where(eq(postUpvoteTable.id, existingUpvote.id));
        } else {
          await tx
            .insert(postUpvoteTable)
            .values({ postId: id, userId: user.id });
        }

        return updated.points;
      });

      return c.json<SuccessResponse<{ count: number; isUpvoted: boolean }>>(
        {
          success: true,
          message: "Post updated",
          data: { count: points, isUpvoted: pointsChange > 0 }
        },
        200
      );
    }
  )
  .post(
    "/:id/comment",
    loggedIn,
    zValidator("param", z.object({ id: z.number() })),
    zValidator("form", createCommentSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { content } = c.req.valid("form");
      const user = c.get("user") as User;

      const [comment] = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(postTable)
          .set({ commentCount: sql`${postTable.commentCount} + 1` })
          .where(eq(postTable.id, id))
          .returning({ commentCount: postTable.commentCount });

        if (!updated) {
          throw new HTTPException(404, { message: "Post not found" });
        }

        return await tx
          .insert(commentTable)
          .values({
            content,
            userId: user.id,
            postId: id
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
          commentUpvotes: [],
          childComments: [],
          author: {
            username: user.username,
            id: user.id
          }
        } as Comment
      });
    }
  )
  .get(
    "/:id/comments",
    zValidator("param", z.object({ id: z.number() })),
    zValidator(
      "query",
      paginationSchema.extend({ includeChildren: z.boolean().optional() })
    ),
    async (c) => {
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const { limit, page, sortBy, orderBy, includeChildren } =
        c.req.valid("query");

      const offset = (page - 1) * limit;

      const [postExists] = await db
        .select({ exists: sql`1` })
        .from(postTable)
        .where(eq(postTable.id, id))
        .limit(1);

      if (!postExists) {
        throw new HTTPException(404, { message: "Post not found" });
      }

      const sortByColumn =
        sortBy === "points" ? commentTable.points : commentTable.createdAt;
      const sortOrder =
        orderBy === "desc" ? desc(sortByColumn) : asc(sortByColumn);

      const [count] = await db
        .select({ count: countDistinct(commentTable.id) })
        .from(commentTable)
        .where(
          and(eq(commentTable.postId, id), isNull(commentTable.parentCommentId))
        );

      const comments = await db.query.comment.findMany({
        where: and(
          eq(commentTable.postId, id),
          isNull(commentTable.parentCommentId)
        ),
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
          },
          childComment: {
            limit: includeChildren ? 2 : 0,
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
            orderBy: sortOrder,
            extras: {
              createdAt: getISOFormatDateQuery(commentTable.createdAt).as(
                "createdAt"
              )
            }
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
  )
  .get("/:id", zValidator("param", z.object({ id: z.number() })), async (c) => {
    const user = c.get("user") as User;

    const { id } = c.req.valid("param");

    const postsQuery = db
      .select({
        id: postTable.id,
        title: postTable.title,
        url: postTable.url,
        points: postTable.points,
        createdAt: getISOFormatDateQuery(postTable.createdAt),
        commentCount: postTable.commentCount,
        author: {
          username: userTable.username,
          id: userTable.id
        },
        isUpvoted: user
          ? sql<boolean>`CASE WHEN ${postUpvoteTable.userId} IS NOT NULL THEN true ELSE false END`
          : sql<boolean>`false`
      })
      .from(postTable)
      .leftJoin(userTable, eq(postTable.userId, userTable.id))
      .where(eq(postTable.id, id));

    if (user) {
      postsQuery.leftJoin(
        postUpvoteTable,
        and(
          eq(postUpvoteTable.postId, postTable.id),
          eq(postUpvoteTable.userId, user.id)
        )
      );
    }

    const [post] = await postsQuery;
    if (!post) {
      throw new HTTPException(404, { message: "Post not found" });
    }

    return c.json<SuccessResponse<Post>>(
      {
        success: true,
        message: "Post fetched",
        data: post as Post
      },
      200
    );
  });
