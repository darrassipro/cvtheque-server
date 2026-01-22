import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database.js';
import { User } from './User.js';
import { CV } from './CV.js';

// ==================== CV LIST ====================

export interface CVListAttributes {
  id: string;
  name: string;
  description?: string;
  userId: string;
  isPublic: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CVListCreationAttributes extends Optional<CVListAttributes, 'id' | 'description' | 'isPublic' | 'createdAt' | 'updatedAt'> {}

export class CVList extends Model<CVListAttributes, CVListCreationAttributes> implements CVListAttributes {
  declare id: string;
  declare name: string;
  declare description?: string;
  declare userId: string;
  declare isPublic: boolean;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

CVList.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'user_id',
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    isPublic: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_public',
    },
  },
  {
    sequelize,
    tableName: 'cv_lists',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['is_public'] },
    ],
  }
);

// ==================== CV LIST ITEM ====================

export interface CVListItemAttributes {
  id: string;
  listId: string;
  cvId: string;
  notes?: string;
  addedAt?: Date;
}

export interface CVListItemCreationAttributes extends Optional<CVListItemAttributes, 'id' | 'notes' | 'addedAt'> {}

export class CVListItem extends Model<CVListItemAttributes, CVListItemCreationAttributes> implements CVListItemAttributes {
  declare id: string;
  declare listId: string;
  declare cvId: string;
  declare notes?: string;
  declare readonly addedAt: Date;
}

CVListItem.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    listId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'list_id',
      references: {
        model: 'cv_lists',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    cvId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'cv_id',
      references: {
        model: 'cvs',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    addedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'added_at',
    },
  },
  {
    sequelize,
    tableName: 'cv_list_items',
    timestamps: false,
    underscored: true,
    indexes: [
      { fields: ['list_id'] },
      { fields: ['cv_id'] },
      { fields: ['list_id', 'cv_id'], unique: true },
    ],
  }
);

// ==================== CV LIST SHARE ====================

export interface CVListShareAttributes {
  id: string;
  listId: string;
  sharedWith: string;
  canEdit: boolean;
  expiresAt?: Date;
  createdAt?: Date;
}

export interface CVListShareCreationAttributes extends Optional<CVListShareAttributes, 'id' | 'canEdit' | 'expiresAt' | 'createdAt'> {}

export class CVListShare extends Model<CVListShareAttributes, CVListShareCreationAttributes> implements CVListShareAttributes {
  declare id: string;
  declare listId: string;
  declare sharedWith: string;
  declare canEdit: boolean;
  declare expiresAt?: Date;
  declare readonly createdAt: Date;

  isExpired(): boolean {
    if (!this.expiresAt) return false;
    return new Date() > this.expiresAt;
  }
}

CVListShare.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    listId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'list_id',
      references: {
        model: 'cv_lists',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    sharedWith: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'shared_with',
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    canEdit: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'can_edit',
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'expires_at',
    },
  },
  {
    sequelize,
    tableName: 'cv_list_shares',
    timestamps: true,
    updatedAt: false,
    underscored: true,
    indexes: [
      { fields: ['list_id'] },
      { fields: ['shared_with'] },
      { fields: ['list_id', 'shared_with'], unique: true },
    ],
  }
);

// ==================== ASSOCIATIONS ====================

// User -> CVList
User.hasMany(CVList, { foreignKey: 'userId', as: 'cvLists' });
CVList.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// CVList -> CVListItem -> CV
CVList.hasMany(CVListItem, { foreignKey: 'listId', as: 'items' });
CVListItem.belongsTo(CVList, { foreignKey: 'listId', as: 'list' });

CV.hasMany(CVListItem, { foreignKey: 'cvId', as: 'listItems' });
CVListItem.belongsTo(CV, { foreignKey: 'cvId', as: 'cv' });

// CVList -> CVListShare -> User
CVList.hasMany(CVListShare, { foreignKey: 'listId', as: 'shares' });
CVListShare.belongsTo(CVList, { foreignKey: 'listId', as: 'list' });

User.hasMany(CVListShare, { foreignKey: 'sharedWith', as: 'sharedLists' });
CVListShare.belongsTo(User, { foreignKey: 'sharedWith', as: 'sharedWithUser' });