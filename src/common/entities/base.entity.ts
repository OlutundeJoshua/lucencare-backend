// TODO: Implement — see docs/modules/entities.md

import { ulid } from 'ulid';

import {
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Column,
  BeforeInsert,
} from 'typeorm';

export abstract class BaseEntity {
  @PrimaryColumn({ type: 'char', length: 26 })
  id: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date;

  @Column({ name: 'created_by', type: 'char', length: 26, nullable: true })
  createdBy?: string;

  @Column({ name: 'updated_by', type: 'char', length: 26, nullable: true })
  updatedBy?: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = ulid();
  }
}
