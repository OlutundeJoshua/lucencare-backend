import { DataSource, InsertEvent, UpdateEvent } from 'typeorm';

import { EntityActorSubscriber } from './entity-actor.subscriber';
import { BaseEntity } from 'src/common/entities/base.entity';

function makeDataSource(): Partial<DataSource> {
  return { subscribers: [] };
}

describe('EntityActorSubscriber', () => {
  let cls: { get: jest.Mock };
  let dataSource: Partial<DataSource>;
  let subscriber: EntityActorSubscriber;

  beforeEach(() => {
    cls = { get: jest.fn() };
    dataSource = makeDataSource();
    subscriber = new EntityActorSubscriber(dataSource as DataSource, cls as any);
  });

  it('registers itself on the DataSource subscribers array', () => {
    expect(dataSource.subscribers).toContain(subscriber);
  });

  describe('beforeInsert', () => {
    it('sets createdBy and updatedBy from CLS userId', () => {
      cls.get.mockReturnValue('user-ulid-01');
      const entity = {} as BaseEntity;
      subscriber.beforeInsert({ entity } as unknown as InsertEvent<BaseEntity>);
      expect(entity.createdBy).toBe('user-ulid-01');
      expect(entity.updatedBy).toBe('user-ulid-01');
    });

    it('leaves createdBy/updatedBy undefined when no userId in CLS', () => {
      cls.get.mockReturnValue(undefined);
      const entity = {} as BaseEntity;
      subscriber.beforeInsert({ entity } as unknown as InsertEvent<BaseEntity>);
      expect(entity.createdBy).toBeUndefined();
      expect(entity.updatedBy).toBeUndefined();
    });
  });

  describe('beforeUpdate', () => {
    it('sets updatedBy from CLS userId', () => {
      cls.get.mockReturnValue('user-ulid-02');
      const entity = {} as BaseEntity;
      subscriber.beforeUpdate({ entity } as unknown as UpdateEvent<BaseEntity>);
      expect((entity as BaseEntity).updatedBy).toBe('user-ulid-02');
    });

    it('does not throw when entity is undefined', () => {
      cls.get.mockReturnValue('user-ulid-02');
      expect(() =>
        subscriber.beforeUpdate({ entity: undefined } as unknown as UpdateEvent<BaseEntity>),
      ).not.toThrow();
    });

    it('leaves updatedBy unchanged when no userId in CLS', () => {
      cls.get.mockReturnValue(undefined);
      const entity = { updatedBy: 'existing' } as BaseEntity;
      subscriber.beforeUpdate({ entity } as unknown as UpdateEvent<BaseEntity>);
      expect(entity.updatedBy).toBe('existing');
    });
  });
});
