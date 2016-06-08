import React from 'react';
import { render } from 'react-dom';

import { find, maxBy, minBy, memoize, bindAll, filter, flatMap, values, xor } from 'lodash';
import { scaleQuantize } from 'd3-scale';

import { colorSteps, dataGenerator } from '../../../test-utils';

import ResponsiveContainer from '../../responsive-container';
import Choropleth from '../';
import Button from '../../button';

const LAYERS = {
  global: { name: 'global', type: 'feature', visible: true },
  subnational: { name: 'subnational', type: 'feature', visible: true },
};

const keyField = 'id';
const valueField = 'mean';
const dataRange = [0, 100];

class App extends React.Component {
  constructor(props) {
    super(props);

    const layers = values(LAYERS);

    this.state = {
      selections: [],
      layers,
    };

    bindAll(this, [
      'toggleVisibility',
      'selectLocation',
    ]);
  }

  updateData(layers, topology) {
    const layerNames = layers.map(layer => layer.name);
    const collections = filter(topology.objects, (collection, name) => {
      return layerNames.includes(name);
    });
    const locIds = flatMap(collections, (collection) => {
      return collection.geometries.map((geometry) => geometry.id);
    });

    const data = dataGenerator({
      primaryKeys: [{ name: keyField, values: locIds }],
      valueKeys: [{ name: valueField, range: dataRange }],
      length: 1
    });

    const colorScale = scaleQuantize()
      .domain(dataRange)
      .range(colorSteps);

    return {
      keyField,
      valueField,
      data,
      domain: dataRange,
      colorScale
    };
  }

  toggleVisibility(layerName) {
    return () => {
      const layers = this.state.layers.slice(0);

      const layer = find(layers, { name: layerName });
      if (layer) {
        layer.visible = !layer.visible;
        this.setState({ layers, })
      }
    }
  }

  selectLocation(_, locId) {
    const { selections } = this.state;

    let newSelections;
    if (selections.includes(locId)) {
      newSelections = selections.filter((loc) => { return loc !== locId; });
    } else {
      newSelections = [...selections, locId];
    }

    this.setState({
      selections: newSelections
    });
  }

  render() {
    const {
      data,
      keyField,
      valueField,
      colorScale,
      selections,
      layers
    } = this.state;

    return (
      <div style={{ display: 'flex', flex: '1 1 auto', justifyContent: 'center'}}>
        <div style={{ flex: '1 0 auto', maxWidth: '70%' }}>
          <ResponsiveContainer>
            <Choropleth
              layers={filter(layers, { visible: true })}
              topology={this.props.topology}
              data={data}
              keyField={keyField}
              valueField={valueField}
              colorScale={colorScale}
              selectedLocations={selections}
              onClick={this.selectLocation}
            />
          </ResponsiveContainer>
        </div>
        <Button
          text="Toggle subnational"
          clickHandler={this.toggleVisibility('subnational')}
        />
      </div>
    );
  }
}

d3.json("https://gist.githubusercontent.com/GabeMedrash/1dce23941015acc17d3fa2a670083d8f/raw/b0ae443ac0ad6d3a2425e12382680e5829345b60/world.topo.json", function(error, topology) {
  if (error) throw error;
  render(<App topology={topology} />, document.getElementById('app'));
});
