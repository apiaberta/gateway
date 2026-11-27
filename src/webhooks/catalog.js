/**
 * Canonical webhook event catalogue.
 *
 * Public GET /v1/webhooks/events is derived from this module. Filter `payloadKeys`
 * are internal (matching) and stripped from the HTTP response.
 */

const DISTRICT_OPTIONS = [
  ['01', 'Aveiro'],
  ['02', 'Beja'],
  ['03', 'Braga'],
  ['04', 'Bragança'],
  ['05', 'Castelo Branco'],
  ['06', 'Coimbra'],
  ['07', 'Évora'],
  ['08', 'Faro'],
  ['09', 'Guarda'],
  ['10', 'Leiria'],
  ['11', 'Lisboa'],
  ['12', 'Portalegre'],
  ['13', 'Porto'],
  ['14', 'Santarém'],
  ['15', 'Setúbal'],
  ['16', 'Viana do Castelo'],
  ['17', 'Vila Real'],
  ['18', 'Viseu'],
  ['RAA', 'Região Autónoma dos Açores'],
  ['RAM', 'Região Autónoma da Madeira']
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

export const FUEL_SLUGS = FUEL_OPTIONS.map(o => o.value)

const FUEL_BRAND_OPTIONS = [
  'GALP', 'BP', 'REPSOL', 'PRIO', 'CEPSA', 'Prio',
  'INTERMARCHÉ', 'AUCHAN', 'CONTINENTE', 'PINGO DOCE', 'E.LECLERC',
  'ALVES BANDEIRA', 'OZ ENERGIA', 'FREITAS', 'JUMBO', 'Genérico'
].map(value => ({ value, label_pt: value }))

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

const IPMA_MIN_LEVEL_OPTIONS = IPMA_LEVEL_OPTIONS.filter(o => o.value !== 'green')

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

const ANPC_NATUREZA_OPTIONS = [
  ['2101', 'Incêndio urbano'],
  ['2103', 'Incêndio industrial'],
  ['2105', 'Incêndio em edifício'],
  ['2107', 'Incêndio em equipamento'],
  ['2109', 'Incêndio em transporte'],
  ['3101', 'Incêndio rural'],
  ['3103', 'Mato'],
  ['3105', 'Agrícola'],
  ['3107', 'Florestal'],
  ['3201', 'Acidente rodoviário'],
  ['4101', 'Busca e salvamento'],
  ['4335', 'Prevenção a queimadas'],
  ['4401', 'Pré-posicionamento']
].map(([value, label_pt]) => ({ value, label_pt }))

const DRE_SERIES_OPTIONS = [
  { value: 'I', label_pt: 'I Série', aliases: ['1'] },
  { value: 'II', label_pt: 'II Série', aliases: ['2'] }
]

const DRE_TYPE_OPTIONS = [
  ['Lei', 'Lei'],
  ['Decreto-Lei', 'Decreto-Lei'],
  ['Decreto Regulamentar', 'Decreto Regulamentar'],
  ['Portaria', 'Portaria'],
  ['Resolução', 'Resolução'],
  ['Despacho', 'Despacho'],
  ['Acórdão', 'Acórdão'],
  ['Aviso', 'Aviso'],
  ['Edital', 'Edital'],
  ['Declaração', 'Declaração'],
  ['Norma regulamentar da Autoridade de Supervisão de Seguros e Fundos de Pensões', 'Norma regulamentar ASF']
].map(([value, label_pt]) => ({ value, label_pt }))

const PARLAMENTO_TIPO_OPTIONS = [
  ['J', 'Projeto de Lei'],
  ['R', 'Projeto de Resolução'],
  ['C', 'Proposta de Lei'],
  ['D', 'Proposta de Resolução'],
  ['E', 'Projeto de Deliberação'],
  ['A', 'Apreciação Parlamentar'],
  ['G', 'Inquérito Parlamentar']
].map(([value, label_pt]) => ({ value, label_pt }))

const PARLAMENTO_ESTADO_OPTIONS = [
  'Entrada',
  'Comissão',
  'Discussão na generalidade',
  'Discussão na especialidade',
  'Aprovado',
  'Rejeitado',
  'Retirado',
  'Caducado'
].map(value => ({ value, label_pt: value }))

const PARLAMENTO_GP_OPTIONS = [
  ['PSD', 'PSD'],
  ['PS', 'PS'],
  ['CH', 'Chega'],
  ['IL', 'Iniciativa Liberal'],
  ['L', 'Livre'],
  ['PCP', 'PCP'],
  ['BE', 'Bloco de Esquerda'],
  ['CDS-PP', 'CDS-PP'],
  ['PAN', 'PAN'],
  ['JPP', 'Juntos pelo Povo']
].map(([value, label_pt]) => ({ value, label_pt }))

const PARLAMENTO_RESULTADO_OPTIONS = [
  ['Aprovado', 'Aprovado'],
  ['Rejeitado', 'Rejeitado'],
  ['Prejudicado', 'Prejudicado']
].map(([value, label_pt]) => ({ value, label_pt }))

const CEME_OPTIONS = [
  'EDP Charge',
  'EDP Charge (clientes EDP)',
  'EVIO',
  'Galp Electric',
  'Goldenergy',
  'Goldenergy (não-cliente)',
  'LUZiGÁS',
  'Via Verde Electric'
].map(value => ({ value, label_pt: value }))

function str(key, label_pt, payloadKeys, extra = {}) {
  return {
    key,
    label_pt,
    type: extra.type || 'string',
    match: extra.match || 'contains_ci',
    placeholder_pt: extra.placeholder_pt,
    payloadKeys,
    multiple: extra.multiple ?? false,
    free_text: extra.free_text ?? false,
    precision: extra.precision,
    pattern: extra.pattern,
    aliases: extra.aliases
  }
}

function enm(key, label_pt, options, payloadKeys, extra = {}) {
  return {
    key,
    label_pt,
    type: 'enum',
    match: extra.match || 'equals',
    options: options || undefined,
    options_source: extra.options_source,
    payloadKeys,
    multiple: extra.multiple ?? true,
    precision: extra.precision,
    aliases: extra.aliases,
    resolve: extra.resolve
  }
}

function num(key, label_pt, payloadKeys, extra = {}) {
  return {
    key,
    label_pt,
    type: 'number',
    match: extra.match || 'gte',
    placeholder_pt: extra.placeholder_pt,
    payloadKeys,
    multiple: false
  }
}

function radius(key, label_pt, extra = {}) {
  return {
    key,
    label_pt,
    type: 'radius',
    match: 'radius',
    placeholder_pt: extra.placeholder_pt || '{ "lat": 40.14, "lon": -7.50, "km": 25 }',
    payloadKeys: extra.payloadKeys || ['lat', 'lon', 'latitude', 'longitude'],
    multiple: false,
    precision: extra.precision || 'coordinates'
  }
}

function municipalityFilter(payloadKeys, extra = {}) {
  return enm('municipality', extra.label_pt || 'Concelho', null, payloadKeys, {
    options_source: '/v1/geo/municipalities',
    precision: extra.precision || 'municipality',
    match: extra.match || 'equals',
    aliases: extra.aliases || ['local', 'concelho'],
    resolve: 'municipality',
    multiple: true
  })
}

function districtFilter(payloadKeys, extra = {}) {
  return enm('district', extra.label_pt || 'Distrito', DISTRICT_OPTIONS, payloadKeys, {
    options_source: '/v1/geo/districts',
    precision: extra.precision || 'district',
    resolve: 'district',
    multiple: true
  })
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
 * @property {string[]} [localFilterKeys]
 * @property {'municipality'|'district'|'coordinates'|'none'} geo_precision
 */

const ANPC_INCIDENT_FILTERS = [
  districtFilter(['district_code', 'district']),
  municipalityFilter(['municipality_code', 'municipality_codes', 'concelho'], { aliases: ['concelho', 'local'] }),
  enm('natureza', 'Natureza', ANPC_NATUREZA_OPTIONS, ['type_code', 'natureza', 'type'], { aliases: ['type'] })
]

export const WEBHOOK_EVENTS = [
  {
    name: 'fuel.prices.updated',
    service: '/v1/fuel',
    kind: 'aggregate',
    geo_precision: 'municipality',
    localFilterKeys: ['district', 'municipality', 'brand'],
    description: 'Fired when DGEG publishes a new daily fuel-price snapshot',
    label_pt: 'Preços de combustíveis atualizados',
    description_pt: 'Disparado quando a DGEG publica a fotografia diária de preços. Sem filtros envia médias nacionais; com distrito, município ou marca envia só os postos correspondentes.',
    payload_fields: ['date', 'diesel_avg', 'gasoline95_avg', 'lpg_avg', 'records', 'fuels', 'stations'],
    filters: [
      districtFilter(['district_code', 'district']),
      municipalityFilter(['municipality_code', 'municipality']),
      enm('fuel', 'Combustível', FUEL_OPTIONS, ['fuel', 'fuel_slug', 'fuel_name']),
      enm('brand', 'Marca', FUEL_BRAND_OPTIONS, ['brand'])
    ]
  },
  {
    name: 'ipma.warning.new',
    service: '/v1/ipma',
    kind: 'item',
    geo_precision: 'district',
    description: 'Fired when IPMA issues a new meteorological warning',
    label_pt: 'Novo aviso meteorológico',
    description_pt: 'Disparado quando o IPMA publica um aviso meteorológico novo (precipitação, vento, agitação marítima, etc.). Avisos verdes não são enviados por omissão — use min_level ou level para os incluir.',
    payload_fields: ['id', 'level', 'type', 'text', 'region', 'area', 'startTime', 'endTime'],
    filters: [
      enm('region', 'Região (código IPMA)', IPMA_REGION_OPTIONS, ['region', 'area'], { precision: 'district' }),
      municipalityFilter(['region', 'area', 'ipma_regions'], {
        label_pt: 'Concelho (mapeado à área do distrito)',
        precision: 'distrito',
        match: 'ipma_area',
        aliases: ['local', 'concelho']
      }),
      enm('level', 'Nível', IPMA_LEVEL_OPTIONS, ['level']),
      enm('min_level', 'Nível mínimo', IPMA_MIN_LEVEL_OPTIONS, ['level'], { match: 'min_level', multiple: false }),
      enm('type', 'Tipo de aviso', IPMA_TYPE_OPTIONS, ['type'])
    ]
  },
  {
    name: 'ipma.seismic.new',
    service: '/v1/ipma',
    kind: 'item',
    geo_precision: 'coordinates',
    description: 'Fired when IPMA records a new earthquake',
    label_pt: 'Novo sismo',
    description_pt: 'Disparado quando entra um novo evento no catálogo sísmico do IPMA (Continente/Madeira ou Açores). O concelho é calculado a partir de lat/lon.',
    payload_fields: ['id', 'time', 'lat', 'lon', 'depth_km', 'magnitude', 'region', 'obs_region', 'sensed', 'municipality_code', 'district_code'],
    filters: [
      enm('region', 'Região', [
        { value: 'continente-madeira', label_pt: 'Continente e Madeira' },
        { value: 'acores', label_pt: 'Açores' }
      ], ['region']),
      municipalityFilter(['municipality_code']),
      radius('radius', 'Raio (lat, lon, km)'),
      num('min_magnitude', 'Magnitude mínima', ['magnitude'], { placeholder_pt: '3' })
    ]
  },
  {
    name: 'anpc.incident.new',
    service: '/v1/anpc',
    kind: 'item',
    geo_precision: 'municipality',
    description: 'Fired when a new civil protection incident is reported',
    label_pt: 'Nova ocorrência da Proteção Civil',
    description_pt: 'Disparado quando a ANEPC (via fogos.pt) reporta uma ocorrência nova — incêndio, socorro, prevenção a queimadas, etc.',
    payload_fields: ['id', 'type', 'type_code', 'natureza', 'location', 'district', 'district_code', 'concelho', 'municipality_code', 'status', 'active', 'reported_at'],
    filters: ANPC_INCIDENT_FILTERS
  },
  {
    name: 'anpc.incident.updated',
    service: '/v1/anpc',
    kind: 'item',
    geo_precision: 'municipality',
    description: 'Fired when an ANPC incident changes status or ends',
    label_pt: 'Ocorrência da Proteção Civil atualizada',
    description_pt: 'Disparado quando uma ocorrência ativa muda de estado ou deixa de estar ativa (fim).',
    payload_fields: ['id', 'type', 'type_code', 'natureza', 'location', 'district', 'district_code', 'concelho', 'municipality_code', 'status', 'active', 'reported_at', 'changed'],
    filters: ANPC_INCIDENT_FILTERS
  },
  {
    name: 'anpc.warning.new',
    service: '/v1/anpc',
    kind: 'item',
    geo_precision: 'none',
    description: 'Fired when a new ANPC/ANEPC road or civil-protection warning is published',
    label_pt: 'Novo aviso da Proteção Civil',
    description_pt: 'Disparado quando surge um aviso rodoviário ou de proteção civil (ex.: via cortada, incêndio). Pesquisa em texto livre — pode falhar.',
    payload_fields: ['id', 'text', 'label', 'source'],
    filters: [
      str('text', 'Texto', ['text', 'label'], { placeholder_pt: 'A1', free_text: true })
    ]
  },
  {
    name: 'base.contract.new',
    service: '/v1/base',
    kind: 'item',
    geo_precision: 'municipality',
    description: 'Fired when a new public contract is published on BASE.gov.pt',
    label_pt: 'Novo contrato público',
    description_pt: 'Disparado quando entra um contrato novo no Portal BASE. /v1/contracts é o mesmo conector — não há evento próprio para o alias.',
    payload_fields: ['id', 'description', 'contractingEntity', 'awarded', 'value', 'date', 'type', 'local', 'municipality_codes', 'district_codes', 'nif_entidade', 'cpv'],
    filters: [
      municipalityFilter(['municipality_codes', 'municipality_code'], { aliases: ['local', 'concelho'] }),
      districtFilter(['district_codes', 'district_code']),
      str('nif_entidade', 'NIF da entidade', ['nif_entidade', 'nifs'], {
        match: 'equals',
        placeholder_pt: '505456010',
        pattern: '^\\d{9}$',
        resolve: 'nif'
      }),
      str('cpv', 'CPV', ['cpv'], {
        match: 'prefix',
        placeholder_pt: '45',
        pattern: '^\\d{2,8}$'
      }),
      num('valor_min', 'Valor mínimo (€)', ['value'], { placeholder_pt: '50000' })
    ]
  },
  {
    name: 'ev.prices.updated',
    service: '/v1/ev',
    kind: 'snapshot',
    geo_precision: 'none',
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
    geo_precision: 'none',
    localFilterKeys: ['ceme'],
    description: 'Fired when CEME EV charging tariffs change',
    label_pt: 'Tarifas CEME atualizadas',
    description_pt: 'Disparado quando o catálogo de tarifas de carregamento (CEME) muda. Com filtro de comercializador envia só essa tarifa.',
    payload_fields: ['updated_at', 'records', 'tariffs'],
    filters: [
      enm('ceme', 'Comercializador (CEME)', CEME_OPTIONS, ['ceme'])
    ]
  },
  {
    name: 'ine.indicator.updated',
    service: '/v1/ine',
    kind: 'item',
    geo_precision: 'none',
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
    geo_precision: 'none',
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
    geo_precision: 'none',
    description: 'Fired when a new Diário da República diploma is listed',
    label_pt: 'Novo diploma do DRE',
    description_pt: 'Disparado quando o conector DRE lista um diploma novo. O filtro q pesquisa título, sumário e emitente (texto livre).',
    payload_fields: ['id', 'title', 'summary', 'emitter', 'series', 'number', 'date', 'type', 'url', 'emitter_municipality'],
    filters: [
      enm('series', 'Série', DRE_SERIES_OPTIONS, ['series']),
      enm('type', 'Tipo de diploma', DRE_TYPE_OPTIONS, ['type', 'tipo']),
      str('q', 'Título / sumário / emitente', ['title', 'summary', 'text', 'emitter'], {
        placeholder_pt: 'Orçamento',
        free_text: true
      }),
      municipalityFilter(['emitter_municipality'], {
        label_pt: 'Município emitente (heurística)',
        precision: 'heuristic',
        aliases: []
      })
    ]
  },
  {
    name: 'nasafirms.fire.new',
    service: '/v1/nasafirms',
    kind: 'item',
    geo_precision: 'coordinates',
    description: 'Fired when NASA FIRMS detects a new fire hotspot over Portugal',
    label_pt: 'Novo hotspot de fogo (NASA FIRMS)',
    description_pt: 'Disparado quando a NASA FIRMS reporta um hotspot satélite novo sobre Portugal (VIIRS ou MODIS). O concelho é calculado a partir das coordenadas.',
    payload_fields: ['id', 'latitude', 'longitude', 'acq_date', 'acq_time', 'satellite', 'instrument', 'confidence', 'frp', 'source', 'municipality_code', 'district_code'],
    filters: [
      enm('source', 'Sensor', NASAFIRMS_SOURCE_OPTIONS, ['source', 'instrument', 'satellite']),
      municipalityFilter(['municipality_code']),
      radius('radius', 'Raio (lat, lon, km)'),
      num('min_frp', 'FRP mínimo', ['frp'], { placeholder_pt: '10' })
    ]
  },
  {
    name: 'carris.alert.new',
    service: '/v1/carris',
    kind: 'item',
    geo_precision: 'none',
    description: 'Fired when Carris Metropolitana publishes a new service alert',
    label_pt: 'Novo alerta da Carris Metropolitana',
    description_pt: 'Disparado quando a Carris Metropolitana publica um alerta de serviço (obras, atrasos, cortes de linha).',
    payload_fields: ['alert_id', 'cause', 'effect', 'header_pt', 'description_pt', 'lines', 'active_from', 'active_to', 'active'],
    filters: [
      str('line', 'Linha', ['lines', 'line', 'line_id'], {
        placeholder_pt: '2539',
        match: 'equals',
        pattern: '^\\d{4}$'
      }),
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
      str('q', 'Texto', ['header_pt', 'description_pt'], { placeholder_pt: 'Loures', free_text: true })
    ]
  },
  {
    name: 'gtfs.changes.new',
    service: '/v1/gtfs',
    kind: 'item',
    geo_precision: 'none',
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
    geo_precision: 'none',
    description: 'Fired when a new parliamentary initiative is registered',
    label_pt: 'Nova iniciativa parlamentar',
    description_pt: 'Disparado quando entra uma iniciativa nova na Assembleia da República (projeto de lei, resolução, etc.).',
    payload_fields: ['ini_id', 'titulo', 'tipo', 'tipo_desc', 'estado', 'leg', 'data_entrada', 'autores_gp', 'numero'],
    filters: [
      enm('tipo', 'Tipo', PARLAMENTO_TIPO_OPTIONS, ['tipo', 'tipo_desc']),
      enm('gp', 'Grupo parlamentar', PARLAMENTO_GP_OPTIONS, ['autores_gp', 'gp']),
      enm('estado', 'Estado', PARLAMENTO_ESTADO_OPTIONS, ['estado'])
    ]
  },
  {
    name: 'parlamento.votacao.new',
    service: '/v1/parlamento',
    kind: 'item',
    geo_precision: 'none',
    description: 'Fired when a new parliamentary vote is recorded',
    label_pt: 'Nova votação parlamentar',
    description_pt: 'Disparado quando é registada uma votação nova na Assembleia da República.',
    payload_fields: ['vot_id', 'data', 'resultado', 'fase', 'ini_id', 'ini_titulo', 'a_favor', 'contra', 'abstencao'],
    filters: [
      enm('resultado', 'Resultado', PARLAMENTO_RESULTADO_OPTIONS, ['resultado']),
      enm('gp', 'Grupo parlamentar (em qualquer bancada)', PARLAMENTO_GP_OPTIONS, ['a_favor', 'contra', 'abstencao', 'gp'])
    ]
  },
  {
    name: 'sns.dataset.updated',
    service: '/v1/sns',
    kind: 'item',
    geo_precision: 'none',
    description: 'Fired when an SNS Transparência dataset is re-synced with a newer period',
    label_pt: 'Dataset do SNS atualizado',
    description_pt: 'Disparado quando um dataset curado do Portal da Transparência SNS muda de last_changed (novo mês de urgências, cirurgias, consultas ou RH).',
    payload_fields: ['key', 'title', 'period_from', 'period_to', 'records', 'last_changed', 'source_url'],
    filters: [
      enm('dataset', 'Dataset', SNS_DATASET_OPTIONS, ['key', 'dataset'])
    ]
  },
  {
    name: 'prr.catalogue.updated',
    service: '/v1/prr',
    kind: 'aggregate',
    geo_precision: 'none',
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
    geo_precision: 'none',
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

export function findFilterSpec(eventName, key) {
  const def = EVENT_BY_NAME[eventName]
  if (!def) return null
  return (def.filters || []).find(f => f.key === key || (f.aliases || []).includes(key)) || null
}

function publicFilter(filter) {
  const out = {
    key: filter.key,
    label_pt: filter.label_pt,
    type: filter.type,
    match: filter.match,
    multiple: Boolean(filter.multiple)
  }
  if (filter.precision) out.precision = filter.precision
  if (filter.free_text) out.free_text = true
  if (filter.options_source) out.options_source = filter.options_source
  if (filter.options) out.options = filter.options.map(({ value, label_pt }) => ({ value, label_pt }))
  if (filter.placeholder_pt) out.placeholder_pt = filter.placeholder_pt
  if (filter.pattern) out.pattern = filter.pattern
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
    geo_precision: e.geo_precision || 'none',
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
