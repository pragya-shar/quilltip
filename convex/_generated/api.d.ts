/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as articleTipVerify from "../articleTipVerify.js";
import type * as articles from "../articles.js";
import type * as arweave from "../arweave.js";
import type * as arweaveHelpers from "../arweaveHelpers.js";
import type * as auth from "../auth.js";
import type * as authorEarningsBackfill from "../authorEarningsBackfill.js";
import type * as betaMetrics from "../betaMetrics.js";
import type * as chain_articles from "../chain/articles.js";
import type * as chain_backfill from "../chain/backfill.js";
import type * as chain_config from "../chain/config.js";
import type * as chain_indexer from "../chain/indexer.js";
import type * as chain_review from "../chain/review.js";
import type * as chain_submissions from "../chain/submissions.js";
import type * as chain_tabReconcile from "../chain/tabReconcile.js";
import type * as crons from "../crons.js";
import type * as earningsTotalsBackfill from "../earningsTotalsBackfill.js";
import type * as feedback from "../feedback.js";
import type * as handles from "../handles.js";
import type * as highlightTips from "../highlightTips.js";
import type * as highlights from "../highlights.js";
import type * as http from "../http.js";
import type * as legacyTipCleanup from "../legacyTipCleanup.js";
import type * as lib_articleBrowseSort from "../lib/articleBrowseSort.js";
import type * as lib_articleListing from "../lib/articleListing.js";
import type * as lib_articleListingReady from "../lib/articleListingReady.js";
import type * as lib_articlePreview from "../lib/articlePreview.js";
import type * as lib_articleSearch from "../lib/articleSearch.js";
import type * as lib_articleSlug from "../lib/articleSlug.js";
import type * as lib_articleTipExpectation from "../lib/articleTipExpectation.js";
import type * as lib_articleTitle from "../lib/articleTitle.js";
import type * as lib_authorEarnings from "../lib/authorEarnings.js";
import type * as lib_chain_articleEvents from "../lib/chain/articleEvents.js";
import type * as lib_chain_articleStore from "../lib/chain/articleStore.js";
import type * as lib_chain_canonicalJson from "../lib/chain/canonicalJson.js";
import type * as lib_chain_coreEventHandlers from "../lib/chain/coreEventHandlers.js";
import type * as lib_chain_env from "../lib/chain/env.js";
import type * as lib_chain_events from "../lib/chain/events.js";
import type * as lib_chain_fees from "../lib/chain/fees.js";
import type * as lib_chain_ids from "../lib/chain/ids.js";
import type * as lib_chain_indexerStore from "../lib/chain/indexerStore.js";
import type * as lib_chain_lease from "../lib/chain/lease.js";
import type * as lib_chain_nftEventHandlers from "../lib/chain/nftEventHandlers.js";
import type * as lib_chain_nftEvents from "../lib/chain/nftEvents.js";
import type * as lib_chain_nftSchema from "../lib/chain/nftSchema.js";
import type * as lib_chain_nftStore from "../lib/chain/nftStore.js";
import type * as lib_chain_rpc from "../lib/chain/rpc.js";
import type * as lib_chain_settlementStore from "../lib/chain/settlementStore.js";
import type * as lib_chain_settlementSubmitter from "../lib/chain/settlementSubmitter.js";
import type * as lib_chain_settler from "../lib/chain/settler.js";
import type * as lib_chain_splits from "../lib/chain/splits.js";
import type * as lib_chain_submissionStore from "../lib/chain/submissionStore.js";
import type * as lib_chain_tabEventHandlers from "../lib/chain/tabEventHandlers.js";
import type * as lib_chain_tabLedger from "../lib/chain/tabLedger.js";
import type * as lib_chain_tipPrepare from "../lib/chain/tipPrepare.js";
import type * as lib_chain_verify from "../lib/chain/verify.js";
import type * as lib_chain_voucher from "../lib/chain/voucher.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_enrich from "../lib/enrich.js";
import type * as lib_fixedWindowLimit from "../lib/fixedWindowLimit.js";
import type * as lib_handleOwner from "../lib/handleOwner.js";
import type * as lib_highlightHash from "../lib/highlightHash.js";
import type * as lib_horizon from "../lib/horizon.js";
import type * as lib_imageUpload from "../lib/imageUpload.js";
import type * as lib_internalAccounts from "../lib/internalAccounts.js";
import type * as lib_lifetimeEarnings from "../lib/lifetimeEarnings.js";
import type * as lib_lifetimeTotalsFields from "../lib/lifetimeTotalsFields.js";
import type * as lib_networkGuard from "../lib/networkGuard.js";
import type * as lib_nftMetadata from "../lib/nftMetadata.js";
import type * as lib_passwordResetEmail from "../lib/passwordResetEmail.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_readingRoomIndex from "../lib/readingRoomIndex.js";
import type * as lib_stellarNetwork from "../lib/stellarNetwork.js";
import type * as lib_stellarTransactionHash from "../lib/stellarTransactionHash.js";
import type * as lib_testAccounts from "../lib/testAccounts.js";
import type * as lib_tipArticleSummary from "../lib/tipArticleSummary.js";
import type * as lib_tipReads from "../lib/tipReads.js";
import type * as lib_tiptapContent from "../lib/tiptapContent.js";
import type * as lib_uploadReferences from "../lib/uploadReferences.js";
import type * as lib_v1Prepares from "../lib/v1Prepares.js";
import type * as lib_v2Earnings from "../lib/v2Earnings.js";
import type * as lib_verifiedTips from "../lib/verifiedTips.js";
import type * as lib_walletChallenge from "../lib/walletChallenge.js";
import type * as lib_walletVerification from "../lib/walletVerification.js";
import type * as lib_wikimediaFileUrl from "../lib/wikimediaFileUrl.js";
import type * as lib_xlmPrice from "../lib/xlmPrice.js";
import type * as nftMetadataUpload from "../nftMetadataUpload.js";
import type * as nfts from "../nfts.js";
import type * as nftsV2 from "../nftsV2.js";
import type * as passwordReset from "../passwordReset.js";
import type * as permanentStorage from "../permanentStorage.js";
import type * as publicRoutes from "../publicRoutes.js";
import type * as readingRoomIndex from "../readingRoomIndex.js";
import type * as reconcileTips from "../reconcileTips.js";
import type * as stellarVerify from "../stellarVerify.js";
import type * as tabActivity from "../tabActivity.js";
import type * as tabSettlement from "../tabSettlement.js";
import type * as tabSettler from "../tabSettler.js";
import type * as tabs from "../tabs.js";
import type * as testAccounts from "../testAccounts.js";
import type * as tipEarnings from "../tipEarnings.js";
import type * as tips from "../tips.js";
import type * as tipsV2 from "../tipsV2.js";
import type * as uploadHttp from "../uploadHttp.js";
import type * as uploadIngress from "../uploadIngress.js";
import type * as uploadTickets from "../uploadTickets.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";
import type * as waitlist from "../waitlist.js";
import type * as walletLink from "../walletLink.js";
import type * as wikimedia from "../wikimedia.js";
import type * as xlmPrice from "../xlmPrice.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  articleTipVerify: typeof articleTipVerify;
  articles: typeof articles;
  arweave: typeof arweave;
  arweaveHelpers: typeof arweaveHelpers;
  auth: typeof auth;
  authorEarningsBackfill: typeof authorEarningsBackfill;
  betaMetrics: typeof betaMetrics;
  "chain/articles": typeof chain_articles;
  "chain/backfill": typeof chain_backfill;
  "chain/config": typeof chain_config;
  "chain/indexer": typeof chain_indexer;
  "chain/review": typeof chain_review;
  "chain/submissions": typeof chain_submissions;
  "chain/tabReconcile": typeof chain_tabReconcile;
  crons: typeof crons;
  earningsTotalsBackfill: typeof earningsTotalsBackfill;
  feedback: typeof feedback;
  handles: typeof handles;
  highlightTips: typeof highlightTips;
  highlights: typeof highlights;
  http: typeof http;
  legacyTipCleanup: typeof legacyTipCleanup;
  "lib/articleBrowseSort": typeof lib_articleBrowseSort;
  "lib/articleListing": typeof lib_articleListing;
  "lib/articleListingReady": typeof lib_articleListingReady;
  "lib/articlePreview": typeof lib_articlePreview;
  "lib/articleSearch": typeof lib_articleSearch;
  "lib/articleSlug": typeof lib_articleSlug;
  "lib/articleTipExpectation": typeof lib_articleTipExpectation;
  "lib/articleTitle": typeof lib_articleTitle;
  "lib/authorEarnings": typeof lib_authorEarnings;
  "lib/chain/articleEvents": typeof lib_chain_articleEvents;
  "lib/chain/articleStore": typeof lib_chain_articleStore;
  "lib/chain/canonicalJson": typeof lib_chain_canonicalJson;
  "lib/chain/coreEventHandlers": typeof lib_chain_coreEventHandlers;
  "lib/chain/env": typeof lib_chain_env;
  "lib/chain/events": typeof lib_chain_events;
  "lib/chain/fees": typeof lib_chain_fees;
  "lib/chain/ids": typeof lib_chain_ids;
  "lib/chain/indexerStore": typeof lib_chain_indexerStore;
  "lib/chain/lease": typeof lib_chain_lease;
  "lib/chain/nftEventHandlers": typeof lib_chain_nftEventHandlers;
  "lib/chain/nftEvents": typeof lib_chain_nftEvents;
  "lib/chain/nftSchema": typeof lib_chain_nftSchema;
  "lib/chain/nftStore": typeof lib_chain_nftStore;
  "lib/chain/rpc": typeof lib_chain_rpc;
  "lib/chain/settlementStore": typeof lib_chain_settlementStore;
  "lib/chain/settlementSubmitter": typeof lib_chain_settlementSubmitter;
  "lib/chain/settler": typeof lib_chain_settler;
  "lib/chain/splits": typeof lib_chain_splits;
  "lib/chain/submissionStore": typeof lib_chain_submissionStore;
  "lib/chain/tabEventHandlers": typeof lib_chain_tabEventHandlers;
  "lib/chain/tabLedger": typeof lib_chain_tabLedger;
  "lib/chain/tipPrepare": typeof lib_chain_tipPrepare;
  "lib/chain/verify": typeof lib_chain_verify;
  "lib/chain/voucher": typeof lib_chain_voucher;
  "lib/constants": typeof lib_constants;
  "lib/email": typeof lib_email;
  "lib/enrich": typeof lib_enrich;
  "lib/fixedWindowLimit": typeof lib_fixedWindowLimit;
  "lib/handleOwner": typeof lib_handleOwner;
  "lib/highlightHash": typeof lib_highlightHash;
  "lib/horizon": typeof lib_horizon;
  "lib/imageUpload": typeof lib_imageUpload;
  "lib/internalAccounts": typeof lib_internalAccounts;
  "lib/lifetimeEarnings": typeof lib_lifetimeEarnings;
  "lib/lifetimeTotalsFields": typeof lib_lifetimeTotalsFields;
  "lib/networkGuard": typeof lib_networkGuard;
  "lib/nftMetadata": typeof lib_nftMetadata;
  "lib/passwordResetEmail": typeof lib_passwordResetEmail;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/readingRoomIndex": typeof lib_readingRoomIndex;
  "lib/stellarNetwork": typeof lib_stellarNetwork;
  "lib/stellarTransactionHash": typeof lib_stellarTransactionHash;
  "lib/testAccounts": typeof lib_testAccounts;
  "lib/tipArticleSummary": typeof lib_tipArticleSummary;
  "lib/tipReads": typeof lib_tipReads;
  "lib/tiptapContent": typeof lib_tiptapContent;
  "lib/uploadReferences": typeof lib_uploadReferences;
  "lib/v1Prepares": typeof lib_v1Prepares;
  "lib/v2Earnings": typeof lib_v2Earnings;
  "lib/verifiedTips": typeof lib_verifiedTips;
  "lib/walletChallenge": typeof lib_walletChallenge;
  "lib/walletVerification": typeof lib_walletVerification;
  "lib/wikimediaFileUrl": typeof lib_wikimediaFileUrl;
  "lib/xlmPrice": typeof lib_xlmPrice;
  nftMetadataUpload: typeof nftMetadataUpload;
  nfts: typeof nfts;
  nftsV2: typeof nftsV2;
  passwordReset: typeof passwordReset;
  permanentStorage: typeof permanentStorage;
  publicRoutes: typeof publicRoutes;
  readingRoomIndex: typeof readingRoomIndex;
  reconcileTips: typeof reconcileTips;
  stellarVerify: typeof stellarVerify;
  tabActivity: typeof tabActivity;
  tabSettlement: typeof tabSettlement;
  tabSettler: typeof tabSettler;
  tabs: typeof tabs;
  testAccounts: typeof testAccounts;
  tipEarnings: typeof tipEarnings;
  tips: typeof tips;
  tipsV2: typeof tipsV2;
  uploadHttp: typeof uploadHttp;
  uploadIngress: typeof uploadIngress;
  uploadTickets: typeof uploadTickets;
  uploads: typeof uploads;
  users: typeof users;
  waitlist: typeof waitlist;
  walletLink: typeof walletLink;
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
