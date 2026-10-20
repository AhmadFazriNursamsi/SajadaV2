import { Module } from '@nestjs/common';
import { AppDownloadModule } from './app-download/app-download.module';
import { InvoicesModule } from './invoices/invoices.module';
import { CoinsModule } from './coins/coins.module';
import { AvatarModule } from './avatar/avatar.module';
import { ProductMediaModule } from './product-media/product-media.module';
import { RewardsModule } from './rewards/rewards.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CentralModule } from './central/central.module';
import { CoreModule } from './core/core.module';
import { DbModule } from './core/db.module';
import { CommissionPlanModule } from './commission-plan/commission-plan.module';
import { DepotsModule } from './depots/depots.module';
import { FinanceModule } from './finance/finance.module';
import { HealthController } from './health.controller';
import { InventoryModule } from './inventory/inventory.module';
import { MeModule } from './me/me.module';
import { MembersModule } from './members/members.module';
import { OrdersModule } from './orders/orders.module';
import { OverviewModule } from './overview/overview.module';
import { ProcurementModule } from './procurement/procurement.module';
import { RegionsModule } from './regions/regions.module';
import { StockCountsModule } from './stock-counts/stock-counts.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [DbModule, CoreModule, AuthModule, MembersModule, AuditModule, CommissionPlanModule, DepotsModule, RegionsModule, InventoryModule, StockCountsModule, OrdersModule, ProcurementModule, FinanceModule, ReportsModule, OverviewModule, CentralModule, MeModule, AppDownloadModule, ProductMediaModule, AvatarModule, RewardsModule, CoinsModule, InvoicesModule],
  controllers: [HealthController],
})
export class AppModule {}
