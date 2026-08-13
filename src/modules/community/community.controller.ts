import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { COMMUNITY_PARTICIPANT_ROLES, CommunityReportTarget, UserRole } from 'src/common/enums';

import { CommunityService } from './community.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreateCommunityDto } from './dto/create-community.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { ListCommunitiesDto } from './dto/list-communities.dto';
import { ListFeedDto } from './dto/list-feed.dto';
import { ListReportsDto } from './dto/list-reports.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { SetVisibilityDto } from './dto/set-visibility.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
import { UpdatePostDto } from './dto/update-post.dto';

/**
 * Rate limit for the three write endpoints that create user-visible content.
 *
 * Tighter than the global 60/60s throttler. This is the first per-route @Throttle in
 * the codebase — flagged deliberately rather than introduced quietly, because it
 * establishes a pattern others will copy.
 */
const WRITE_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('community')
@ApiBearerAuth()
@Controller('community')
// Class-level, so ngo_admin, hmo_coordinator and researcher get a 403 on every route
// here with no per-route work — including any route added later. The community is a
// patient-support space; an organisation reading it would be reading health
// disclosures no ConsentGrant covers.
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(...COMMUNITY_PARTICIPANT_ROLES)
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  // Static segments only, so there is no static-vs-:param ordering hazard.

  @Get('overview')
  @ApiOperation({ summary: 'Platform-wide community counters for the portal header' })
  async overview() {
    return this.communityService.getOverview();
  }

  @Get('trending')
  @ApiOperation({ summary: 'Most-used tags on recent posts' })
  async trending() {
    return this.communityService.getTrending();
  }

  @Get('stats')
  @ApiOperation({ summary: "The caller's own community numbers, for their dashboard" })
  async stats(@CurrentUser() user: JwtPayload) {
    return this.communityService.getStats(user.sub);
  }

  // ── Communities ────────────────────────────────────────────────────────────

  @Get('communities')
  @ApiOperation({ summary: 'Browse active communities' })
  async listCommunities(@Query() query: ListCommunitiesDto, @CurrentUser() user: JwtPayload) {
    const { communities, nextCursor } = await this.communityService.listCommunities(user.sub, query);
    return { data: communities, meta: { cursor: nextCursor, limit: query.limit } };
  }

  @Post('communities')
  // Narrows the class-level guard: patients found the spaces, everyone else joins
  // them. A professional or benefactor founding a patient-support community changes
  // what the community is for.
  @Roles(UserRole.PATIENT)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Create a community (patients only)' })
  @ApiResponse({ status: 403, description: 'Only patients may create a community' })
  async createCommunity(@Body() dto: CreateCommunityDto, @CurrentUser() user: JwtPayload) {
    // Bare: TransformInterceptor only unwraps a payload carrying BOTH data and meta,
    // so a hand-wrapped { data } would ship as { data: { data } }.
    return this.communityService.createCommunity(user.sub, dto);
  }

  @Get('communities/:id')
  @ApiOperation({ summary: 'One community' })
  @ApiResponse({ status: 404, description: 'Not found or archived' })
  async getCommunity(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.communityService.getCommunity(user.sub, id);
  }

  @Post('communities/:id/join')
  @HttpCode(200)
  @ApiOperation({ summary: 'Join a community (idempotent)' })
  async join(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.communityService.joinCommunity(user.sub, id);
  }

  @Delete('communities/:id/join')
  @ApiOperation({ summary: 'Leave a community. Your posts stay.' })
  async leave(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.communityService.leaveCommunity(user.sub, id);
  }

  @Post('communities/:id/posts')
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Post in a community you have joined' })
  @ApiResponse({ status: 403, description: 'Not a member of this community' })
  @ApiResponse({ status: 409, description: 'Community is archived' })
  async createPost(
    @Param('id') communityId: string,
    @Body() dto: CreatePostDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.communityService.createPost(user.sub, communityId, dto);
  }

  // ── Posts ──────────────────────────────────────────────────────────────────

  @Get('posts')
  @ApiOperation({ summary: 'The feed: all communities, one community, or only joined' })
  async listFeed(@Query() query: ListFeedDto, @CurrentUser() user: JwtPayload) {
    const { posts, nextCursor } = await this.communityService.listFeed(user.sub, query);
    return { data: posts, meta: { cursor: nextCursor, limit: query.limit } };
  }

  @Get('posts/mine')
  @ApiOperation({ summary: "The caller's own posts, including any a moderator hid" })
  async listMyPosts(@Query() query: PaginationDto, @CurrentUser() user: JwtPayload) {
    const { posts, nextCursor } = await this.communityService.listMyPosts(user.sub, query);
    return { data: posts, meta: { cursor: nextCursor, limit: query.limit } };
  }

  @Get('posts/unanswered')
  @ApiOperation({ summary: 'Posts nobody has replied to yet' })
  async listUnanswered(@Query() query: PaginationDto, @CurrentUser() user: JwtPayload) {
    const { posts, nextCursor } = await this.communityService.listUnanswered(user.sub, query);
    return { data: posts, meta: { cursor: nextCursor, limit: query.limit } };
  }

  @Get('posts/:id')
  @ApiOperation({ summary: 'One post. A hidden one is visible only to its author.' })
  @ApiResponse({ status: 404, description: 'Not found, or hidden and not yours' })
  async getPost(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.communityService.getPost(user.sub, id);
  }

  @Patch('posts/:id')
  @ApiOperation({ summary: 'Edit your own post' })
  @ApiResponse({ status: 403, description: 'Not your post' })
  @ApiResponse({ status: 409, description: 'Post has been removed by a moderator' })
  async updatePost(
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.communityService.updatePost(user.sub, id, dto);
  }

  @Delete('posts/:id')
  @ApiOperation({ summary: 'Delete your own post' })
  async deletePost(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.communityService.deletePost(user.sub, id);
  }

  // ── Comments ───────────────────────────────────────────────────────────────

  @Get('posts/:id/comments')
  @ApiOperation({ summary: 'The thread under a post, oldest first' })
  async listComments(
    @Param('id') postId: string,
    @Query() query: PaginationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const { comments, nextCursor } = await this.communityService.listComments(user.sub, postId, query);
    return { data: comments, meta: { cursor: nextCursor, limit: query.limit } };
  }

  @Post('posts/:id/comments')
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Comment on a post, or reply to a comment' })
  @ApiResponse({ status: 403, description: 'Not a member of this community' })
  async createComment(
    @Param('id') postId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.communityService.createComment(user.sub, postId, dto);
  }

  @Patch('comments/:id')
  @ApiOperation({ summary: 'Edit your own comment' })
  async updateComment(
    @Param('id') id: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.communityService.updateComment(user.sub, id, dto);
  }

  @Delete('comments/:id')
  @ApiOperation({ summary: 'Delete your own comment' })
  async deleteComment(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.communityService.deleteComment(user.sub, id);
  }

  // ── Reactions ──────────────────────────────────────────────────────────────
  // POST/DELETE rather than a toggle: a toggle double-fired by a flaky client
  // silently un-likes. Both are idempotent and return the authoritative count.

  @Post('posts/:id/reactions')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a post helpful' })
  @ApiResponse({ status: 409, description: 'You cannot mark your own contribution' })
  async reactToPost(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.communityService.react(user.sub, CommunityReportTarget.POST, id);
  }

  @Delete('posts/:id/reactions')
  @ApiOperation({ summary: 'Remove your mark from a post' })
  async unreactToPost(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.communityService.unreact(user.sub, CommunityReportTarget.POST, id);
  }

  @Post('comments/:id/reactions')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a comment helpful' })
  async reactToComment(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.communityService.react(user.sub, CommunityReportTarget.COMMENT, id);
  }

  @Delete('comments/:id/reactions')
  @ApiOperation({ summary: 'Remove your mark from a comment' })
  async unreactToComment(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.communityService.unreact(user.sub, CommunityReportTarget.COMMENT, id);
  }

  // ── Reports ────────────────────────────────────────────────────────────────

  @Post('posts/:id/reports')
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Report a post to the moderators' })
  @ApiResponse({ status: 409, description: 'You already have an open report on this' })
  async reportPost(
    @Param('id') id: string,
    @Body() dto: CreateReportDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.communityService.reportContent(user.sub, CommunityReportTarget.POST, id, dto);
  }

  @Post('comments/:id/reports')
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Report a comment to the moderators' })
  async reportComment(
    @Param('id') id: string,
    @Body() dto: CreateReportDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.communityService.reportContent(user.sub, CommunityReportTarget.COMMENT, id, dto);
  }
}

/**
 * The moderation surface.
 *
 * Lives in CommunityModule rather than AdminController so that AdminModule need not
 * import CommunityModule, and so every community query stays in one service. The URL
 * still sits under /admin/*, so the client's admin API base path is unchanged.
 */
@ApiTags('community-moderation')
@ApiBearerAuth()
@Controller('admin/community')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(UserRole.PLATFORM_ADMIN)
export class CommunityModerationController {
  constructor(private readonly communityService: CommunityService) {}

  @Get('reports')
  @ApiOperation({ summary: 'The moderation queue, newest first' })
  async listReports(@Query() query: ListReportsDto) {
    const { reports, nextCursor } = await this.communityService.listReports(query);
    return { data: reports, meta: { cursor: nextCursor, limit: query.limit } };
  }

  @Patch('reports/:id')
  @ApiOperation({ summary: 'Hide the reported content, or dismiss the report' })
  @ApiResponse({ status: 409, description: 'This report has already been reviewed' })
  @ApiResponse({ status: 422, description: 'A reason is required when hiding' })
  async resolveReport(
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.communityService.resolveReport(user.sub, id, dto);
  }

  @Patch('posts/:id/visibility')
  @ApiOperation({ summary: 'Hide or restore a post directly' })
  async setPostVisibility(
    @Param('id') id: string,
    @Body() dto: SetVisibilityDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.communityService.setPostVisibility(user.sub, id, dto);
  }

  @Patch('comments/:id/visibility')
  @ApiOperation({ summary: 'Hide or restore a comment directly' })
  async setCommentVisibility(
    @Param('id') id: string,
    @Body() dto: SetVisibilityDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.communityService.setCommentVisibility(user.sub, id, dto);
  }

  /**
   * Bootstrap and curation.
   *
   * Participants who may found a community are patients only — but without this an
   * empty platform is deadlocked: nobody can post until some patient happens to
   * create the first community, and the platform has no say in the starter set.
   * Admins already own edit and archive here; a moderation surface that cannot
   * create is the hole that produced the deadlock.
   */
  @Post('communities')
  @ApiOperation({ summary: 'Create a community as the platform (starter set, curation)' })
  async createCommunity(@Body() dto: CreateCommunityDto, @CurrentUser() user: JwtPayload) {
    // joinFounder: false — an admin is not a participant, and auto-joining them
    // would seat a non-participant in every community's member roster.
    return this.communityService.createCommunity(user.sub, dto, { joinFounder: false });
  }

  @Patch('communities/:id')
  @ApiOperation({ summary: 'Edit or archive a community' })
  async updateCommunity(
    @Param('id') id: string,
    @Body() dto: UpdateCommunityDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.communityService.updateCommunity(user.sub, id, dto);
  }
}
