import { formatBRL } from '../../utils/format'

/**
 * Pure comparison panel. It never suggests or applies interest/discount:
 * it only shows what the user typed and flags divergences.
 */
export default function ValueConference({
  nominal,
  costs = [],
  net,
  nominalLabel = 'Valor nominal',
  costsLabel = 'Descontos, juros e despesas',
  netLabel = 'Valor líquido informado',
}) {
  const nominalValue = Number(nominal) || 0
  const costsValue = costs.reduce((total, item) => total + (Number(item.value) || 0), 0)
  const netValue = Number(net) || 0
  const expected = nominalValue - costsValue
  const divergence = expected - netValue
  const hasDivergence = nominalValue > 0 && net !== '' && Math.abs(divergence) > 0.01
  const blocking = nominalValue > 0 && (netValue > nominalValue || costsValue > nominalValue)

  return (
    <div className="conference">
      <div className="conference-head">
        <span className="conference-icon">
          <i className="bi bi-calculator" />
        </span>
        <div>
          <strong>Conferência dos valores</strong>
          <small>O sistema não calcula encargos. Apenas compara o que você informou.</small>
        </div>
      </div>

      <dl className="conference-rows">
        <div>
          <dt>{nominalLabel}</dt>
          <dd>{formatBRL(nominalValue)}</dd>
        </div>
        <div>
          <dt>{costsLabel}</dt>
          <dd>{formatBRL(costsValue)}</dd>
        </div>
        <div className="conference-derived">
          <dt>Nominal − custos informados</dt>
          <dd>{formatBRL(expected)}</dd>
        </div>
        <div className="conference-net">
          <dt>{netLabel}</dt>
          <dd>{net === '' ? '—' : formatBRL(netValue)}</dd>
        </div>
      </dl>

      {blocking && (
        <div className="conference-alert danger">
          <i className="bi bi-octagon-fill" />
          <span>
            O líquido ou os custos não podem superar o valor nominal. Corrija os valores para salvar.
          </span>
        </div>
      )}

      {!blocking && hasDivergence && (
        <div className="conference-alert warning">
          <i className="bi bi-exclamation-triangle-fill" />
          <span>
            Divergência de <strong>{formatBRL(Math.abs(divergence))}</strong> entre nominal − custos e o
            líquido informado. Você pode salvar assim mesmo: os valores são gravados exatamente como
            digitados e a divergência será destacada.
          </span>
        </div>
      )}

      {!blocking && !hasDivergence && nominalValue > 0 && net !== '' && (
        <div className="conference-alert success">
          <i className="bi bi-check-circle-fill" />
          <span>Os valores informados estão coerentes entre si.</span>
        </div>
      )}
    </div>
  )
}
