import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../src/App';

describe('advisor app flow', () => {
  it('loads sample teams and shows ranked recommendations', async () => {
    render(<App />);

    expect(screen.getByTestId('setup-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('battle-tab')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/type 1/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/type 2/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('combobox', { name: /ability/i })[0]).toHaveAttribute('list', 'ability-options');
    expect(document.getElementById('ability-options')?.querySelectorAll('option').length).toBeGreaterThan(0);
    expect(document.querySelector('#species-options option[value="Mega Charizard Y"]')).toBeInTheDocument();
    expect(document.querySelector('#opponent-species-options option[value="Mega Charizard Y"]')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /load sample/i }));
    expect(screen.getAllByTestId('inferred-types')[0]).toHaveTextContent(/Fire/);
    expect(screen.getAllByTestId('inferred-types')[0]).toHaveTextContent(/Flying/);

    fireEvent.click(screen.getByRole('button', { name: /battle preview/i }));

    expect(screen.getByTestId('battle-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-tab')).not.toBeInTheDocument();
    expect(screen.getAllByRole('combobox', { name: /species/i })[0]).toHaveAttribute('list', 'opponent-species-options');
    expect(screen.queryByRole('spinbutton', { name: /speed/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/known move/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getAllByRole('combobox', { name: /species/i })[0], { target: { value: 'Mega Garchomp' } });
    expect(screen.getByDisplayValue('Garchomp')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /common/i }));
    expect(screen.getByDisplayValue('Garchomp')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Mega Garchomp')).not.toBeInTheDocument();

    const list = await screen.findByTestId('recommendation-list');
    expect(within(list).getAllByRole('button').length).toBeGreaterThan(0);
    expect(screen.getByTestId('recommendation-detail')).toHaveTextContent(/confidence/i);
  });
});
