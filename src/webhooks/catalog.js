/**
 * Canonical webhook event catalogue.
 *
 * Public GET /v1/webhooks/events is derived from this module. Filter `payloadKeys`
 * are internal (matching) and stripped from the HTTP response.
 */

const DISTRICT_OPTIONS = [
  ['Aveiro', 'Aveiro'],
  ['Beja', 'Beja'],
  ['Braga', 'Braga'],
  ['Bragança', 'Bragança'],
  ['Castelo Branco', 'Castelo Branco'],
  ['Coimbra', 'Coimbra'],
  ['Évora', 'Évora'],
  ['Faro', 'Faro'],
  ['Guarda', 'Guarda'],
  ['Leiria', 'Leiria'],
  ['Lisboa', 'Lisboa'],
  ['Portalegre', 'Portalegre'],
  ['Porto', 'Porto'],
  ['Santarém', 'Santarém'],
  ['Setúbal', 'Setúbal'],
  ['Viana do Castelo', 'Viana do Castelo'],
  ['Vila Real', 'Vila Real'],
  ['Viseu', 'Viseu'],
  ['Açores', 'Açores'],
  ['Madeira', 'Madeira']
].map(([value, label_pt]) => ({ value, label_pt }))

const FUEL_OPTIONS = [
  ['diesel', 'Gasóleo simples'],
  ['diesel_plus', 'Gasóleo especial'],
  ['diesel_colored', 'Gasóleo colorido'],
  ['diesel_heating', 'Gasóleo de aquecimento'],
  ['gasoline_95', 'Gasolina simples 95'],
  ['gasoline_95_plus', 'Gasolina especial 95'],
  ['gasoline_98', 'Gasolina 98'],
  ['gasoline_98_plus', 'Gasolina especial 98'],
  ['gpl_auto', 'GPL Auto'],
  ['biodiesel_b15', 'Biodiesel B15'],
  ['gasoline_2stroke', 'Gasolina mistura (2 tempos)'],
  ['gnc_kg', 'GNC (€/kg)'],
  ['gnc_m3', 'GNC (€/m³)'],
  ['gnl_kg', 'GNL (€/kg)']
].map(([value, label_pt]) => ({ value, label_pt }))

const IPMA_REGION_OPTIONS = [
  ['LSB', 'Lisboa'],
  ['PTO', 'Porto'],
  ['AVR', 'Aveiro'],
  ['BJA', 'Beja'],
  ['BRG', 'Braga'],
  ['BGC', 'Bragança'],
  ['CBO', 'Castelo Branco'],
  ['CBR', 'Coimbra'],
  ['EVR', 'Évora'],
  ['FAR', 'Faro'],
  ['GDA', 'Guarda'],
  ['LRA', 'Leiria'],
  ['PTG', 'Portalegre'],
  ['STM', 'Santarém'],
  ['STB', 'Setúbal'],
  ['VCT', 'Viana do Castelo'],
  ['VRL', 'Vila Real'],
  ['VIS', 'Viseu'],
  ['ACE', 'Açores Oriental'],
  ['AOC', 'Açores Central'],
  ['AOR', 'Açores Ocidental'],
  ['MCN', 'Madeira Norte'],
  ['MCS', 'Madeira Sul'],
  ['MPS', 'Porto Santo'],
  ['MRM', 'Desertas / Selvagens']
].map(([value, label_pt]) => ({ value, label_pt }))

const IPMA_LEVEL_OPTIONS = [
  { value: 'yellow', label_pt: 'Amarelo' },
  { value: 'orange', label_pt: 'Laranja' },
  { value: 'red', label_pt: 'Vermelho' },
  { value: 'green', label_pt: 'Verde' }
]

const IPMA_TYPE_OPTIONS = [
  'Precipitação',
  'Vento',
  'Trovoada',
  'Neve',
  'Nevoeiro',
  'Tempo Quente',
  'Tempo Frio',
  'Agitação Marítima'
].map(value => ({ value, label_pt: value }))

const INE_INDICATOR_OPTIONS = [
  ['birth_rate', 'Taxa de natalidade'],
  ['death_rate', 'Taxa de mortalidade'],
  ['gdp', 'PIB'],
  ['gdp_per_capita', 'PIB per capita'],
  ['inflation', 'Inflação (IHPC)'],
  ['population', 'População residente'],
  ['unemployment_rate', 'Taxa de desemprego']
].map(([value, label_pt]) => ({ value, label_pt }))

const BDP_KEY_OPTIONS = [
  ['ecb_mro', 'BCE — operações principais de refinanciamento (MRO)'],
  ['ecb_deposit', 'BCE — facilidade de depósito'],
  ['ecb_marginal_lending', 'BCE — facilidade de cedência marginal'],
  ['estr', '€STR'],
  ['tba', 'TBA (BdP, a partir das Euribor)']
].map(([value, label_pt]) => ({ value, label_pt }))

const SNS_DATASET_OPTIONS = [
  ['urgencias', 'Urgências hospitalares'],
  ['urgencias_triagem', 'Urgências por triagem de Manchester'],
  ['cirurgia_tmrg', 'Cirurgia — TMRG 270 dias'],
  ['cirurgia_tmrg_onco', 'Cirurgia — TMRG 180 dias'],
  ['consultas_hospitalares', 'Consultas hospitalares'],
  ['consultas_tmrg', 'Primeiras consultas em tempo adequado'],
  ['consultas_csp', 'Consultas nos cuidados de saúde primários'],
  ['rh', 'Recursos humanos']
].map(([value, label_pt]) => ({ value, label_pt }))

const PRR_COMPONENT_OPTIONS = [
  ['C01', 'C01 — Serviço Nacional de Saúde'],
  ['C02', 'C02 — Habitação'],
  ['C03', 'C03 — Respostas sociais'],
  ['C04', 'C04 — Cultura'],
  ['C05', 'C05 — Investimento e inovação'],
  ['C06', 'C06 — Qualificações e competências'],
  ['C07', 'C07 — Infraestruturas'],
  ['C08', 'C08 — Florestas'],
  ['C09', 'C09 — Gestão hídrica']
].map(([value, label_pt]) => ({ value, label_pt }))

const GTFS_FEED_OPTIONS = [
  ['carris-metropolitana', 'Carris Metropolitana'],
  ['metro-lisboa', 'Metropolitano de Lisboa'],
  ['cp', 'CP — Comboios de Portugal'],
  ['fertagus', 'Fertagus'],
  ['metro-porto', 'Metro do Porto'],
  ['stcp', 'STCP']
].map(([value, label_pt]) => ({ value, label_pt }))

const NASAFIRMS_SOURCE_OPTIONS = [
  { value: 'VIIRS_SNPP', label_pt: 'VIIRS S-NPP' },
  { value: 'MODIS', label_pt: 'MODIS' }
]

function str(key, label_pt, payloadKeys, extra = {}) {
  return {
    key,
    label_pt,
    type: 'string',
    match: extra.match || 'contains_ci',
    placeholder_pt: extra.placeholder_pt,
    payloadKeys
  }
}

function enm(key, label_pt, options, payloadKeys, extra = {}) {
  return {
    key,
    label_pt,
    type: 'enum',
    match: extra.match || 'equals',
    options,
    payloadKeys
  }
}

function num(key, label_pt, payloadKeys, extra = {}) {
  return {
    key,
    label_pt,
    type: 'number',
    match: extra.match || 'gte',
    placeholder_pt: extra.placeholder_pt,
    payloadKeys
  }
}

export const LOOKUP_ONLY_SERVICES = [
  {
    service: '/v1/nif',
    name: 'NIF Validator',
    reason: 'On-demand NIF checksum and VIES company lookup. No time-series of new records.',
    reason_pt: 'Consulta pontual (validação MOD 11 e lookup VIES). Não há série de dados novos a notificar.'
  },
  {
    service: '/v1/geo',
    name: 'Geographic Data (geoapi.pt)',
    reason: 'Static administrative geography (districts, municipalities, parishes, postal codes).',
    reason_pt: 'Geografia administrativa de consulta (distritos, municípios, freguesias, códigos postais). Não gera eventos.'
  },
  {
    service: '/v1/contracts',
    name: 'Public Contracts alias (BASE)',
    reason: 'Alias of /v1/base. Subscribe to base.contract.new.',
    reason_pt: 'Alias de /v1/base. Use o evento base.contract.new; não existe evento próprio.'
  }
]

/**
 * @typedef {object} WebhookEventDef
 * @property {string} name
 * @property {string} service
 * @property {string} description
 * @property {string} label_pt
 * @property {string} description_pt
 * @property {string[]} payload_fields
 * @property {object[]} filters
 * @property {'item'|'aggregate'|'snapshot'} kind
 * @property {string[]} [localFilterKeys]  // switch aggregate payload to matching records
 */

export const WEBHOOK_EVENTS = [
  {
    name: 'fuel.prices.updated',
    service: '/v1/fuel',
    kind: 'aggregate',
    localFilterKeys: ['district', 'municipality', 'brand'],
    description: 'Fired when DGEG publishes a new daily fuel-price snapshot',
    label_pt: 'Preços de combustíveis atualizados',
    description_pt: 'Disparado quando a DGEG publica a fotografia diária de preços. Sem filtros envia médias nacionais; com distrito, município ou marca envia só os postos correspondentes.',
    payload_fields: ['date', 'diesel_avg', 'gasoline95_avg', 'lpg_avg', 'records', 'fuels', 'stations'],
    filters: [
      enm('district', 'Distrito', DISTRICT_OPTIONS, ['district']),
      str('municipality', 'Município', ['municipality'], { placeholder_pt: 'Fundão' }),
      enm('fuel', 'Combustível', FUEL_OPTIONS, ['fuel', 'fuel_slug', 'fuel_name']),
      str('brand', 'Marca', ['brand'], { placeholder_pt: 'GALP' })
    ]
  },
  {
    name: 'ipma.warning.new',
    service: '/v1/ipma',
    kind: 'item',
    description: 'Fired when IPMA issues a new meteorological warning',
    label_pt: 'Novo aviso meteorológico',
    description_pt: 'Disparado quando o IPMA publica um aviso meteorológico novo (precipitação, vento, agitação marítima, etc.).',
    payload_fields: ['id', 'level', 'type', 'text', 'region', 'area', 'startTime', 'endTime'],
    filters: [
      enm('region', 'Região (código IPMA)', IPMA_REGION_OPTIONS, ['region', 'area']),
      str('area', 'Área / região', ['region', 'area'], { placeholder_pt: 'LSB' }),
      enm('level', 'Nível', IPMA_LEVEL_OPTIONS, ['level']),
      enm('type', 'Tipo de aviso', IPMA_TYPE_OPTIONS, ['type'])
    ]
  },
  {
    name: 'ipma.seismic.new',
    service: '/v1/ipma',
    kind: 'item',
    description: 'Fired when IPMA records a new earthquake',
    label_pt: 'Novo sismo',
    description_pt: 'Disparado quando entra um novo evento no catálogo sísmico do IPMA (Continente/Madeira ou Açores).',
    payload_fields: ['id', 'time', 'lat', 'lon', 'depth_km', 'magnitude', 'region', 'obs_region', 'sensed'],
    filters: [
      enm('region', 'Região', [
        { value: 'continente-madeira', label_pt: 'Continente e Madeira' },
        { value: 'acores', label_pt: 'Açores' }
      ], ['region']),
      num('min_magnitude', 'Magnitude mínima', ['magnitude'], { placeholder_pt: '3' })
    ]
  },
  {
    name: 'anpc.incident.new',
    service: '/v1/anpc',
    kind: 'item',
    description: 'Fired when a new civil protection incident is reported',
    label_pt: 'Nova ocorrência da Proteção Civil',
    description_pt: 'Disparado quando a ANEPC (via fogos.pt) reporta uma ocorrência nova — incêndio, socorro, prevenção a queimadas, etc.',
    payload_fields: ['id', 'type', 'natureza', 'location', 'district', 'concelho', 'status', 'active', 'reported_at'],
    filters: [
      enm('district', 'Distrito', DISTRICT_OPTIONS, ['district']),
      str('concelho', 'Concelho', ['concelho', 'municipality'], { placeholder_pt: 'Fundão' }),
      str('natureza', 'Natureza', ['natureza', 'type'], { placeholder_pt: 'Incêndio' }),
      str('type', 'Tipo / natureza', ['type', 'natureza'], { placeholder_pt: 'Incêndio' })
    ]
  },
  {
    name: 'anpc.warning.new',
    service: '/v1/anpc',
    kind: 'item',
    description: 'Fired when a new ANPC/ANEPC road or civil-protection warning is published',
    label_pt: 'Novo aviso da Proteção Civil',
    description_pt: 'Disparado quando surge um aviso rodoviário ou de proteção civil (ex.: via cortada, incêndio).',
    payload_fields: ['id', 'text', 'label', 'source'],
    filters: [
      str('text', 'Texto', ['text', 'label'], { placeholder_pt: 'A1' })
    ]
  },
  {
    name: 'base.contract.new',
    service: '/v1/base',
    kind: 'item',
    description: 'Fired when a new public contract is published on BASE.gov.pt',
    label_pt: 'Novo contrato público',
    description_pt: 'Disparado quando entra um contrato novo no Portal BASE. /v1/contracts é o mesmo conector — não há evento próprio para o alias.',
    payload_fields: ['id', 'description', 'contractingEntity', 'awarded', 'value', 'date', 'type', 'local', 'nif_entidade', 'cpv'],
    filters: [
      str('local', 'Local de execução', ['local'], { placeholder_pt: 'Fundão' }),
      str('nif_entidade', 'NIF da entidade', ['nif_entidade', 'nifs'], { match: 'equals', placeholder_pt: '505690173' }),
      str('cpv', 'CPV', ['cpv'], { placeholder_pt: '45233120' }),
      num('valor_min', 'Valor mínimo (€)', ['value'], { placeholder_pt: '50000' })
    ]
  },
  {
    name: 'ev.prices.updated',
    service: '/v1/ev',
    kind: 'snapshot',
    description: 'Fired when OMIE electricity market prices are updated',
    label_pt: 'Preço OMIE atualizado',
    description_pt: 'Disparado quando muda o período do preço spot OMIE em Portugal (mercado diário, intervalos de 15 min).',
    payload_fields: ['period', 'price_eur_mwh', 'price_eur_kwh', 'source'],
    filters: [
      num('min_price_eur_mwh', 'Preço mínimo (€/MWh)', ['price_eur_mwh'], { placeholder_pt: '80' })
    ]
  },
  {
    name: 'ev.tariffs.updated',
    service: '/v1/ev',
    kind: 'aggregate',
    localFilterKeys: ['ceme'],
    description: 'Fired when CEME EV charging tariffs change',
    label_pt: 'Tarifas CEME atualizadas',
    description_pt: 'Disparado quando o catálogo de tarifas de carregamento (CEME) muda. Com filtro de comercializador envia só essa tarifa.',
    payload_fields: ['updated_at', 'records', 'tariffs'],
    filters: [
      str('ceme', 'Comercializador (CEME)', ['ceme'], { placeholder_pt: 'EDP Charge' })
    ]
  },
  {
    name: 'ine.indicator.updated',
    service: '/v1/ine',
    kind: 'item',
    description: 'Fired when an INE/Eurostat indicator gets a new value or year',
    label_pt: 'Indicador estatístico atualizado',
    description_pt: 'Disparado quando um indicador do INE/Eurostat (PIB, população, desemprego, inflação, …) muda de valor ou de ano.',
    payload_fields: ['indicator', 'label', 'unit', 'year', 'value'],
    filters: [
      enm('indicator', 'Indicador', INE_INDICATOR_OPTIONS, ['indicator'])
    ]
  },
  {
    name: 'bdp.rates.updated',
    service: '/v1/bdp',
    kind: 'aggregate',
    localFilterKeys: ['key'],
    description: 'Fired when Banco de Portugal / ECB reference rates change',
    label_pt: 'Taxas de juro atualizadas',
    description_pt: 'Disparado quando mudam as taxas de referência do BdP/BCE (€STR, MRO, TBA, facilidades). Com filtro envia só a série pedida.',
    payload_fields: ['synced_at', 'records', 'rates'],
    filters: [
      enm('key', 'Série', BDP_KEY_OPTIONS, ['key'])
    ]
  },
  {
    name: 'dre.diploma.new',
    service: '/v1/dre',
    kind: 'item',
    description: 'Fired when a new Diário da República diploma is listed',
    label_pt: 'Novo diploma do DRE',
    description_pt: 'Disparado quando o conector DRE lista um diploma novo (I Série). Depende de /dre/legislation ou /dre/latest devolverem uma lista com ids.',
    payload_fields: ['id', 'title', 'series', 'number', 'date', 'type', 'url'],
    filters: [
      enm('series', 'Série', [
        { value: '1', label_pt: 'I Série' },
        { value: '2', label_pt: 'II Série' },
        { value: '3', label_pt: 'III Série' }
      ], ['series']),
      str('type', 'Tipo de diploma', ['type', 'tipo'], { placeholder_pt: 'Decreto-Lei' }),
      str('q', 'Título / sumário', ['title', 'summary', 'text'], { placeholder_pt: 'Orçamento' })
    ]
  },
  {
    name: 'nasafirms.fire.new',
    service: '/v1/nasafirms',
    kind: 'item',
    description: 'Fired when NASA FIRMS detects a new fire hotspot over Portugal',
    label_pt: 'Novo hotspot de fogo (NASA FIRMS)',
    description_pt: 'Disparado quando a NASA FIRMS reporta um hotspot satélite novo sobre Portugal (VIIRS ou MODIS).',
    payload_fields: ['id', 'latitude', 'longitude', 'acq_date', 'acq_time', 'satellite', 'instrument', 'confidence', 'frp', 'source'],
    filters: [
      enm('source', 'Sensor', NASAFIRMS_SOURCE_OPTIONS, ['source', 'instrument', 'satellite']),
      num('min_frp', 'FRP mínimo', ['frp'], { placeholder_pt: '10' })
    ]
  },
  {
    name: 'carris.alert.new',
    service: '/v1/carris',
    kind: 'item',
    description: 'Fired when Carris Metropolitana publishes a new service alert',
    label_pt: 'Novo alerta da Carris Metropolitana',
    description_pt: 'Disparado quando a Carris Metropolitana publica um alerta de serviço (obras, atrasos, cortes de linha).',
    payload_fields: ['alert_id', 'cause', 'effect', 'header_pt', 'description_pt', 'lines', 'active_from', 'active_to', 'active'],
    filters: [
      str('line', 'Linha', ['lines', 'line', 'line_id'], { placeholder_pt: '2539' }),
      enm('effect', 'Efeito', [
        { value: 'SIGNIFICANT_DELAYS', label_pt: 'Atrasos significativos' },
        { value: 'NO_SERVICE', label_pt: 'Sem serviço' },
        { value: 'REDUCED_SERVICE', label_pt: 'Serviço reduzido' },
        { value: 'DETOUR', label_pt: 'Desvio' },
        { value: 'STOP_MOVED', label_pt: 'Paragem deslocada' },
        { value: 'ADDITIONAL_SERVICE', label_pt: 'Serviço adicional' },
        { value: 'MODIFIED_SERVICE', label_pt: 'Serviço alterado' },
        { value: 'OTHER_EFFECT', label_pt: 'Outro' }
      ], ['effect']),
      str('q', 'Texto', ['header_pt', 'description_pt'], { placeholder_pt: 'Loures' })
    ]
  },
  {
    name: 'gtfs.changes.new',
    service: '/v1/gtfs',
    kind: 'item',
    description: 'Fired when a GTFS feed ingest detects schedule diffs',
    label_pt: 'Alteração de horários GTFS',
    description_pt: 'Disparado quando a ingestão GTFS deteta diffs (paragens, rotas ou viagens) num feed de operador. O conector GTFS não expõe alertas de serviço em tempo real — esses estão em carris.alert.new.',
    payload_fields: ['feed_id', 'version_hash', 'detected_at', 'summary'],
    filters: [
      enm('feed_id', 'Feed / operador', GTFS_FEED_OPTIONS, ['feed_id'])
    ]
  },
  {
    name: 'parlamento.iniciativa.new',
    service: '/v1/parlamento',
    kind: 'item',
    description: 'Fired when a new parliamentary initiative is registered',
    label_pt: 'Nova iniciativa parlamentar',
    description_pt: 'Disparado quando entra uma iniciativa nova na Assembleia da República (projeto de lei, resolução, etc.).',
    payload_fields: ['ini_id', 'titulo', 'tipo', 'tipo_desc', 'estado', 'leg', 'data_entrada', 'autores_gp', 'numero'],
    filters: [
      str('tipo', 'Tipo', ['tipo', 'tipo_desc'], { placeholder_pt: 'Projeto de Lei' }),
      str('gp', 'Grupo parlamentar', ['autores_gp', 'gp'], { placeholder_pt: 'PS' }),
      str('estado', 'Estado', ['estado'], { placeholder_pt: 'Entrada' })
    ]
  },
  {
    name: 'parlamento.votacao.new',
    service: '/v1/parlamento',
    kind: 'item',
    description: 'Fired when a new parliamentary vote is recorded',
    label_pt: 'Nova votação parlamentar',
    description_pt: 'Disparado quando é registada uma votação nova na Assembleia da República.',
    payload_fields: ['vot_id', 'data', 'resultado', 'fase', 'ini_id', 'ini_titulo', 'a_favor', 'contra', 'abstencao'],
    filters: [
      str('resultado', 'Resultado', ['resultado'], { placeholder_pt: 'Aprovado' }),
      str('gp', 'Grupo parlamentar (em qualquer bancada)', ['a_favor', 'contra', 'abstencao'], { placeholder_pt: 'IL' })
    ]
  },
  {
    name: 'sns.dataset.updated',
    service: '/v1/sns',
    kind: 'item',
    description: 'Fired when an SNS Transparência dataset is re-synced with a newer period',
    label_pt: 'Dataset do SNS atualizado',
    description_pt: 'Disparado quando um dataset curado do Portal da Transparência SNS muda de last_changed (novo mês de urgências, cirurgias, consultas ou RH).',
    payload_fields: ['key', 'title', 'period_from', 'period_to', 'records', 'last_changed', 'source_url'],
    filters: [
      enm('dataset', 'Dataset', SNS_DATASET_OPTIONS, ['key', 'dataset']),
      str('regiao', 'Região', ['regiao'], { placeholder_pt: 'Centro' })
    ]
  },
  {
    name: 'prr.catalogue.updated',
    service: '/v1/prr',
    kind: 'aggregate',
    localFilterKeys: ['component'],
    description: 'Fired when the PRR component/investment catalogue changes',
    label_pt: 'Catálogo PRR atualizado',
    description_pt: 'Disparado quando muda o catálogo de componentes e investimentos do PRR. O conector não lista pagamentos individuais — só o catálogo público.',
    payload_fields: ['plan', 'total_components', 'total_investments', 'components', 'investments'],
    filters: [
      enm('component', 'Componente', PRR_COMPONENT_OPTIONS, ['id', 'component', 'parent_id'])
    ]
  },
  {
    name: 'pt2030.summary.updated',
    service: '/v1/pt2030',
    kind: 'snapshot',
    description: 'Fired when the Portugal 2030 summary payload changes',
    label_pt: 'Resumo Portugal 2030 atualizado',
    description_pt: 'Disparado quando muda o resumo do Portugal 2030. O conector ainda não expõe projetos ou pagamentos individuais.',
    payload_fields: ['plan', 'execution_period', 'total_budget', 'source'],
    filters: []
  }
]

export const EVENT_BY_NAME = Object.fromEntries(WEBHOOK_EVENTS.map(e => [e.name, e]))

export const SUPPORTED_EVENTS = WEBHOOK_EVENTS.map(e => e.name)

export function getEventDef(name) {
  return EVENT_BY_NAME[name] || null
}

function publicFilter(filter) {
  const out = {
    key: filter.key,
    label_pt: filter.label_pt,
    type: filter.type,
    match: filter.match
  }
  if (filter.options) out.options = filter.options
  if (filter.placeholder_pt) out.placeholder_pt = filter.placeholder_pt
  return out
}

export function publicEventCatalog() {
  return WEBHOOK_EVENTS.map(e => ({
    name: e.name,
    service: e.service,
    description: e.description,
    label_pt: e.label_pt,
    description_pt: e.description_pt,
    payload_fields: e.payload_fields,
    filters: e.filters.map(publicFilter)
  }))
}

export function serializeWebhook(doc) {
  const w = doc.toObject ? doc.toObject() : doc
  return {
    id: w._id,
    url: w.url,
    events: w.events,
    filters: w.filters && typeof w.filters === 'object' && !Array.isArray(w.filters) ? w.filters : {},
    active: w.active,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt
  }
}
