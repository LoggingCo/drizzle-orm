import type { BuildColumns } from '~/column-builder';
import { entityKind } from '~/entity';
import type { TypedQueryBuilder } from '~/query-builders/query-builder';
import type { AddAliasToSelection } from '~/query-builders/select.types';
import type { SQL } from '~/sql';
import { SelectionProxyHandler } from '~/subquery';
import { getTableColumns } from '~/utils';
import { type ColumnsSelection, View } from '~/view';
import type { AnyMySqlColumnBuilder } from './columns/common';
import { QueryBuilder } from './query-builders';
import type { SelectedFields } from './query-builders/select.types';
import { mysqlTable } from './table';

export interface ViewBuilderConfig {
	algorithm?: 'undefined' | 'merge' | 'temptable';
	definer?: string;
	sqlSecurity?: 'definer' | 'invoker';
	withCheckOption?: 'cascaded' | 'local';
}

export class ViewBuilderCore<TConfig extends { name: string; columns?: unknown }> {
	static readonly [entityKind]: string = 'MySqlViewBuilder';

	declare readonly _: {
		readonly name: TConfig['name'];
		readonly columns: TConfig['columns'];
	};

	constructor(
		protected name: TConfig['name'],
		protected schema: string | undefined,
	) {}

	protected config: ViewBuilderConfig = {};

	algorithm(
		algorithm: Exclude<ViewBuilderConfig['algorithm'], undefined>,
	): this {
		this.config.algorithm = algorithm;
		return this;
	}

	definer(
		definer: Exclude<ViewBuilderConfig['definer'], undefined>,
	): this {
		this.config.definer = definer;
		return this;
	}

	sqlSecurity(
		sqlSecurity: Exclude<ViewBuilderConfig['sqlSecurity'], undefined>,
	): this {
		this.config.sqlSecurity = sqlSecurity;
		return this;
	}

	withCheckOption(
		withCheckOption?: Exclude<ViewBuilderConfig['withCheckOption'], undefined>,
	): this {
		this.config.withCheckOption = withCheckOption ?? 'cascaded';
		return this;
	}
}

export class ViewBuilder<TName extends string = string> extends ViewBuilderCore<{ name: TName }> {
	static readonly [entityKind]: string = 'MySqlViewBuilder';

	as<TSelectedFields extends SelectedFields>(
		qb: TypedQueryBuilder<TSelectedFields> | ((qb: QueryBuilder) => TypedQueryBuilder<TSelectedFields>),
	): MySqlViewWithSelection<TName, false, AddAliasToSelection<TSelectedFields, TName>> {
		if (typeof qb === 'function') {
			qb = qb(new QueryBuilder());
		}
		const selectionProxy = new SelectionProxyHandler<TSelectedFields>({
			alias: this.name,
			sqlBehavior: 'error',
			sqlAliasedBehavior: 'alias',
			replaceOriginalName: true,
		});
		const aliasedSelection = new Proxy(qb.getSelectedFields(), selectionProxy);
		return new Proxy(
			new MySqlView({
				mysqlConfig: this.config,
				config: {
					name: this.name,
					schema: this.schema,
					selectedFields: aliasedSelection,
					query: qb.getSQL().inlineParams(),
				},
			}),
			selectionProxy as any,
		) as MySqlViewWithSelection<TName, false, AddAliasToSelection<TSelectedFields, TName>>;
	}
}

export class ManualViewBuilder<
	TName extends string = string,
	TColumns extends Record<string, AnyMySqlColumnBuilder> = Record<string, AnyMySqlColumnBuilder>,
> extends ViewBuilderCore<{ name: TName; columns: TColumns }> {
	static readonly [entityKind]: string = 'MySqlManualViewBuilder';

	private columns: BuildColumns<TName, TColumns>;

	constructor(
		name: TName,
		columns: TColumns,
		schema: string | undefined,
	) {
		super(name, schema);
		this.columns = getTableColumns(mysqlTable(name, columns)) as BuildColumns<TName, TColumns>;
	}

	existing(): MySqlViewWithSelection<TName, true, BuildColumns<TName, TColumns>> {
		return new Proxy(
			new MySqlView({
				mysqlConfig: undefined,
				config: {
					name: this.name,
					schema: this.schema,
					selectedFields: this.columns,
					query: undefined,
				},
			}),
			new SelectionProxyHandler({
				alias: this.name,
				sqlBehavior: 'error',
				sqlAliasedBehavior: 'alias',
				replaceOriginalName: true,
			}),
		) as MySqlViewWithSelection<TName, true, BuildColumns<TName, TColumns>>;
	}

	as(query: SQL): MySqlViewWithSelection<TName, false, BuildColumns<TName, TColumns>> {
		return new Proxy(
			new MySqlView({
				mysqlConfig: this.config,
				config: {
					name: this.name,
					schema: this.schema,
					selectedFields: this.columns,
					query: query.inlineParams(),
				},
			}),
			new SelectionProxyHandler({
				alias: this.name,
				sqlBehavior: 'error',
				sqlAliasedBehavior: 'alias',
				replaceOriginalName: true,
			}),
		) as MySqlViewWithSelection<TName, false, BuildColumns<TName, TColumns>>;
	}
}

export abstract class MySqlViewBase<
	TName extends string = string,
	TExisting extends boolean = boolean,
	TSelectedFields extends ColumnsSelection = ColumnsSelection,
> extends View<TName, TExisting, TSelectedFields> {
	static readonly [entityKind]: string = 'MySqlViewBase';

	declare readonly _: View<TName, TExisting, TSelectedFields>['_'] & {
		readonly viewBrand: 'MySqlViewBase';
	};
}

export const MySqlViewConfig = Symbol.for('drizzle:MySqlViewConfig');

export class MySqlView<
	TName extends string = string,
	TExisting extends boolean = boolean,
	TSelectedFields extends ColumnsSelection = ColumnsSelection,
> extends MySqlViewBase<TName, TExisting, TSelectedFields> {
	static readonly [entityKind]: string = 'MySqlView';

	declare protected $MySqlViewBrand: 'MySqlView';

	[MySqlViewConfig]: ViewBuilderConfig | undefined;

	constructor({ mysqlConfig, config }: {
		mysqlConfig: ViewBuilderConfig | undefined;
		config: {
			name: TName;
			schema: string | undefined;
			selectedFields: SelectedFields;
			query: SQL | undefined;
		};
	}) {
		super(config);
		this[MySqlViewConfig] = mysqlConfig;
	}
}

export type MySqlViewWithSelection<
	TName extends string,
	TExisting extends boolean,
	TSelectedFields extends ColumnsSelection,
> = MySqlView<TName, TExisting, TSelectedFields> & TSelectedFields;

/** @internal */
export function mysqlViewWithSchema(
	name: string,
	selection: Record<string, AnyMySqlColumnBuilder> | undefined,
	schema: string | undefined,
): ViewBuilder | ManualViewBuilder {
	if (selection) {
		return new ManualViewBuilder(name, selection, schema);
	}
	return new ViewBuilder(name, schema);
}

export function mysqlView<TName extends string>(name: TName): ViewBuilder<TName>;
export function mysqlView<TName extends string, TColumns extends Record<string, AnyMySqlColumnBuilder>>(
	name: TName,
	columns: TColumns,
): ManualViewBuilder<TName, TColumns>;
export function mysqlView(
	name: string,
	selection?: Record<string, AnyMySqlColumnBuilder>,
): ViewBuilder | ManualViewBuilder {
	return mysqlViewWithSchema(name, selection, undefined);
}
