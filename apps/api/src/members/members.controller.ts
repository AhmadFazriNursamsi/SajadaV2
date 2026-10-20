import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Patch, Query } from '@nestjs/common';
import { activationSchema, createMemberSchema, deactivateMemberSchema, fundingSchema, placementSchema, sponsorSchema, updateMemberSchema } from '@sajadah/shared';
import { ADMIN, CurrentActor, Roles } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';
import { ZodPipe } from '../common/zod.pipe';
import { MembersService } from './members.service';

@Controller('members')
@Roles(...ADMIN) // data anggota hanya untuk pengurus; petugas toko tidak melihatnya
export class MembersController {
  constructor(private readonly svc: MembersService) {}

  @Get() list(@CurrentActor() a: Actor) { return this.svc.list(a.tid); }
  @Get('network') network(@CurrentActor() a: Actor) { return this.svc.network(a.tid); }
  @Get('referral/:code') referral(@CurrentActor() a: Actor, @Param('code') code: string) { return this.svc.referralPreview(a.tid, code); }
  @Get('next-number') nextNumber(@CurrentActor() a: Actor, @Query('villageId', ParseUUIDPipe) villageId: string) { return this.svc.nextNumber(a.tid, villageId); }

  @Post()
  create(@CurrentActor() a: Actor, @Body(new ZodPipe(createMemberSchema)) b: any) { return this.svc.create(a, b); }

  @Post(':id/placement')
  place(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(placementSchema)) b: any) { return this.svc.place(a, id, b); }

  @Post(':id/member-number')
  number(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.issueNumber(a, id); }

  @Post(':id/funding') @Roles('tenant_admin')
  fund(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(fundingSchema)) b: any) { return this.svc.recordFunding(a, id, b); }

  @Post(':id/activation') @Roles('tenant_admin')
  activate(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(activationSchema)) b: any) { return this.svc.activate(a, id, b); }

  @Patch(':id') @Roles('tenant_admin')
  edit(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateMemberSchema)) b: any) { return this.svc.update(a, id, b); }

  @Post(':id/deactivate') @Roles('tenant_admin')
  deactivate(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(deactivateMemberSchema)) b: any) { return this.svc.deactivate(a, id, b.reason); }

  @Post(':id/reactivate') @Roles('tenant_admin')
  reactivate(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.reactivate(a, id); }

  @Patch(':id/sponsor')
  sponsor(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(sponsorSchema)) b: any) { return this.svc.setSponsor(a, id, b.sponsorId); }

}
