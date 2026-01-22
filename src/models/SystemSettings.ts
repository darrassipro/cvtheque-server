import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database.js';

export interface SystemSettingsAttributes {
  id: string;
  key: string;
  value: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SystemSettingsCreationAttributes extends Optional<SystemSettingsAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export class SystemSettings extends Model<SystemSettingsAttributes, SystemSettingsCreationAttributes> implements SystemSettingsAttributes {
  declare id: string;
  declare key: string;
  declare value: Record<string, any>;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  static async getSetting<T = any>(key: string, defaultValue?: T): Promise<T | undefined> {
    const setting = await SystemSettings.findOne({ where: { key } });
    return setting ? (setting.value as T) : defaultValue;
  }

  static async setSetting<T = any>(key: string, value: T): Promise<SystemSettings> {
    const [setting] = await SystemSettings.upsert({ key, value: value as any });
    return setting;
  }
}

SystemSettings.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    key: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    value: {
      type: DataTypes.JSON,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'system_settings',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['key'], unique: true },
    ],
  }
);