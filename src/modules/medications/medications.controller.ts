import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { UserRole } from 'src/common/enums';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from 'src/common/decorators/current-user.decorator';

import { MedicationsService } from './medications.service';
import { CreateMedicationDto } from './dto/create-medication.dto';
import { UpdateMedicationDto } from './dto/update-medication.dto';
import { LogDoseDto } from './dto/log-dose.dto';
import { MedicationScheduleQueryDto } from './dto/medication-schedule-query.dto';
import { RegisterRemindersDto } from './dto/register-reminders.dto';

@ApiTags('medications')
@ApiBearerAuth()
@Controller('medications')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(UserRole.PATIENT)
export class MedicationsController {
  constructor(private readonly medicationsService: MedicationsService) {}

  // Static routes first — must be defined before /:id routes

  @Get()
  @ApiOperation({ summary: 'List the authenticated patient\'s medications' })
  @ApiResponse({ status: 200, description: 'List of medications' })
  listMedications(@CurrentUser() user: JwtPayload) {
    return this.medicationsService.listMedications(user.sub);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Add a medication' })
  @ApiResponse({ status: 201, description: 'Medication created' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  createMedication(@Body() dto: CreateMedicationDto, @CurrentUser() user: JwtPayload) {
    return this.medicationsService.createMedication(user.sub, dto);
  }

  @Get('schedule')
  @ApiOperation({ summary: 'Get the dose schedule for a given date (defaults to today)' })
  @ApiResponse({ status: 200, description: 'Schedule slots for the date' })
  getSchedule(@Query() query: MedicationScheduleQueryDto, @CurrentUser() user: JwtPayload) {
    return this.medicationsService.getSchedule(user.sub, query.date);
  }

  @Get('refills')
  @ApiOperation({ summary: 'Get refill alerts for medications approaching or past their refill date' })
  @ApiResponse({ status: 200, description: 'Refill alerts' })
  getRefillAlerts(@CurrentUser() user: JwtPayload) {
    return this.medicationsService.getRefillAlerts(user.sub);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get medication adherence stats for the dashboard/shell' })
  @ApiResponse({ status: 200, description: 'Aggregate stats' })
  getStats(@CurrentUser() user: JwtPayload) {
    return this.medicationsService.getStats(user.sub);
  }

  @Post('reminders/register')
  @HttpCode(200)
  @ApiOperation({ summary: 'Opt in to medication reminder notifications' })
  @ApiResponse({ status: 200, description: 'Reminders registered' })
  registerReminders(@Body() dto: RegisterRemindersDto, @CurrentUser() user: JwtPayload) {
    return this.medicationsService.registerReminders(user.sub, dto);
  }

  @Delete('reminders/unregister')
  @ApiOperation({ summary: 'Opt out of medication reminder notifications' })
  @ApiResponse({ status: 200, description: 'Reminders unregistered' })
  unregisterReminders(@CurrentUser() user: JwtPayload) {
    return this.medicationsService.unregisterReminders(user.sub);
  }

  // Dynamic routes below

  @Patch(':id')
  @ApiOperation({ summary: 'Update a medication' })
  @ApiResponse({ status: 200, description: 'Updated medication' })
  @ApiResponse({ status: 404, description: 'Medication not found' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  updateMedication(
    @Param('id') id: string,
    @Body() dto: UpdateMedicationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.medicationsService.updateMedication(user.sub, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Discontinue a medication' })
  @ApiResponse({ status: 200, description: 'Medication discontinued' })
  @ApiResponse({ status: 404, description: 'Medication not found' })
  deleteMedication(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.medicationsService.deleteMedication(user.sub, id);
  }

  @Post(':id/doses/log')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log a dose as taken, pending, later, or skipped' })
  @ApiResponse({ status: 200, description: 'Dose log updated' })
  @ApiResponse({ status: 404, description: 'Medication not found' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  logDose(@Param('id') id: string, @Body() dto: LogDoseDto, @CurrentUser() user: JwtPayload) {
    return this.medicationsService.logDose(user.sub, id, dto);
  }

  @Post(':id/request-refill')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request a refill for a medication' })
  @ApiResponse({ status: 200, description: 'Refill requested' })
  @ApiResponse({ status: 404, description: 'Medication not found' })
  requestRefill(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.medicationsService.requestRefill(user.sub, id);
  }
}
