import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { RegionsModule } from '../regions/regions.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({ imports: [RegionsModule, AccountsModule], controllers: [MembersController], providers: [MembersService], exports: [MembersService] })
export class MembersModule {}
