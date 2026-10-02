import { Codicon, host } from '@hermes/plugin-sdk'

const previewOnly = (name: string) => host.notify({ kind: 'info', message: `${name} is a visual preview for now.` })

export function RosterVibeNav() {
  return (
    <>
      <div className="merna-workspace-header">
        <button
          aria-label="DaisyLabs workspace preview"
          className="merna-workspace-name"
          onClick={() => previewOnly('Workspaces')}
          type="button"
        >
          DaisyLabs <Codicon name="chevron-down" />
        </button>
      </div>

      <nav aria-label="Workspace preview" className="merna-workspace-nav">
        {(
          [
            ['home', 'Home'],
            ['comment-discussion', 'DMs'],
            ['bell', 'Activity'],
            ['ellipsis', 'More']
          ] as const
        ).map(([icon, label]) => (
          <button className="merna-workspace-nav-item" key={label} onClick={() => previewOnly(label)} type="button">
            <Codicon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="merna-channels">
        <div className="merna-section-caption">Channels</div>
        {['general', 'product'].map(channel => (
          <button className="merna-channel-row" key={channel} onClick={() => previewOnly(`#${channel}`)} type="button">
            <span aria-hidden="true" className="merna-channel-hash">
              #
            </span>
            <span>{channel}</span>
          </button>
        ))}
      </div>
    </>
  )
}

export function RosterVibeFooter({ onHire }: { onHire: () => void }) {
  return (
    <div className="merna-sidebar-bottom">
      <button className="merna-hire-button" onClick={onHire} type="button">
        <span className="merna-hire-plus">
          <Codicon name="add" />
        </span>
        <span>Hire new agents</span>
        <Codicon className="merna-hire-arrow" name="arrow-right" />
      </button>
      <button className="merna-settings-button" onClick={() => host.navigate('/settings')} type="button">
        <Codicon name="gear" />
        <span>Settings</span>
      </button>
    </div>
  )
}
