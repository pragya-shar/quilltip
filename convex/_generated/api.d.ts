/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as articles from "../articles.js";
import type * as arweave from "../arweave.js";
import type * as arweaveHelpers from "../arweaveHelpers.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as highlightTips from "../highlightTips.js";
import type * as highlights from "../highlights.js";
import type * as http from "../http.js";
import type * as lib_articleListing from "../lib/articleListing.js";
import type * as lib_articleListingReady from "../lib/articleListingReady.js";
import type * as lib_articleSlug from "../lib/articleSlug.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_enrich from "../lib/enrich.js";
import type * as lib_highlightHash from "../lib/highlightHash.js";
import type * as lib_horizon from "../lib/horizon.js";
import type * as lib_nftMetadata from "../lib/nftMetadata.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_tiptapContent from "../lib/tiptapContent.js";
import type * as lib_wikimediaFileUrl from "../lib/wikimediaFileUrl.js";
import type * as lib_xlmPrice from "../lib/xlmPrice.js";
import type * as nftMetadataUpload from "../nftMetadataUpload.js";
import type * as nfts from "../nfts.js";
import type * as reconcileTips from "../reconcileTips.js";
import type * as stellarVerify from "../stellarVerify.js";
import type * as tips from "../tips.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";
import type * as wikimedia from "../wikimedia.js";
import type * as xlmPrice from "../xlmPrice.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  articles: typeof articles;
  arweave: typeof arweave;
  arweaveHelpers: typeof arweaveHelpers;
  auth: typeof auth;
  crons: typeof crons;
  highlightTips: typeof highlightTips;
  highlights: typeof highlights;
  http: typeof http;
  "lib/articleListing": typeof lib_articleListing;
  "lib/articleListingReady": typeof lib_articleListingReady;
  "lib/articleSlug": typeof lib_articleSlug;
  "lib/constants": typeof lib_constants;
  "lib/enrich": typeof lib_enrich;
  "lib/highlightHash": typeof lib_highlightHash;
  "lib/horizon": typeof lib_horizon;
  "lib/nftMetadata": typeof lib_nftMetadata;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/tiptapContent": typeof lib_tiptapContent;
  "lib/wikimediaFileUrl": typeof lib_wikimediaFileUrl;
  "lib/xlmPrice": typeof lib_xlmPrice;
  nftMetadataUpload: typeof nftMetadataUpload;
  nfts: typeof nfts;
  reconcileTips: typeof reconcileTips;
  stellarVerify: typeof stellarVerify;
  tips: typeof tips;
  uploads: typeof uploads;
  users: typeof users;
  wikimedia: typeof wikimedia;
  xlmPrice: typeof xlmPrice;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
