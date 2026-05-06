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
    expect(screen.getAllByRole('button', { name: /clear slot/i })[0]).toHaveAttribute('tabindex', '-1');

    const firstSpeciesInput = screen.getAllByRole('combobox', { name: /species/i })[0];
    expect(firstSpeciesInput).toHaveAttribute('aria-autocomplete', 'list');
    fireEvent.focus(firstSpeciesInput);
    fireEvent.change(firstSpeciesInput, { target: { value: 'Weav' } });
    expect(screen.getByRole('option', { name: 'Weavile' })).toBeInTheDocument();
    fireEvent.keyDown(firstSpeciesInput, { key: 'Tab' });
    expect(screen.getByDisplayValue('Weavile')).toBeInTheDocument();

    const firstAbilityInput = screen.getAllByRole('combobox', { name: /ability/i })[0];
    fireEvent.focus(firstAbilityInput);
    fireEvent.change(firstAbilityInput, { target: { value: 'Pres' } });
    expect(screen.getByRole('option', { name: 'Pressure' })).toBeInTheDocument();
    fireEvent.keyDown(firstAbilityInput, { key: 'Tab' });
    expect(screen.getByDisplayValue('Pressure')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /load sample/i }));
    expect(screen.getAllByTestId('inferred-types')[0]).toHaveTextContent(/Fire/);
    expect(screen.getAllByTestId('inferred-types')[0]).toHaveTextContent(/Flying/);

    fireEvent.click(screen.getByRole('button', { name: /battle preview/i }));

    expect(screen.getByTestId('battle-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-tab')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /clear slot/i })[0]).toHaveAttribute('tabindex', '-1');
    expect(screen.queryByRole('spinbutton', { name: /speed/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/known move/i)).not.toBeInTheDocument();
    const opponentSpeciesInput = screen.getAllByRole('combobox', { name: /species/i })[0];
    fireEvent.change(opponentSpeciesInput, { target: { value: 'Mega Garchomp' } });
    expect(screen.getByDisplayValue('Garchomp')).toBeInTheDocument();

    fireEvent.focus(opponentSpeciesInput);
    fireEvent.change(opponentSpeciesInput, { target: { value: 'Chari' } });
    expect(screen.getByRole('option', { name: 'Charizard' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Mega Charizard Y' })).not.toBeInTheDocument();
    fireEvent.keyDown(opponentSpeciesInput, { key: 'Tab' });
    expect(screen.getByDisplayValue('Charizard')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /common/i }));
    expect(screen.getByDisplayValue('Garchomp')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Mega Garchomp')).not.toBeInTheDocument();

    const list = await screen.findByTestId('recommendation-list');
    expect(within(list).getAllByRole('button').length).toBeGreaterThan(0);
    expect(screen.getByTestId('recommendation-detail')).toHaveTextContent(/confidence/i);
  });
});
