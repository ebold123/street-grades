from typing import Optional, Tuple
import osmnet
import pandas
import argparse
from geopy.distance import distance
import os


def get_cached_edges_nodes(data_path: str) -> Tuple[pandas.DataFrame, pandas.DataFrame]:
    try:
        edges_path = os.path.join(data_path, "osmnet_edges.csv")
        nodes_path = os.path.join(data_path, "osmnet_nodes.csv")
        edges = pandas.read_csv(edges_path)
        nodes = pandas.read_csv(nodes_path)
        return nodes, edges
    except FileNotFoundError:
        return pandas.DataFrame(), pandas.DataFrame()


def remove_nonroad_edges(df: pandas.DataFrame) -> pandas.DataFrame:
    df = df[
        (df.highway != "path") & (df.highway != "footway") & (df.highway != "steps")
    ]
    df = df[df.service != "parking_aisle"]
    return df


def join_lat_lng(
    nodes_df: pandas.DataFrame, edges_df: pandas.DataFrame
) -> pandas.DataFrame:

    df = edges_df.merge(nodes_df, left_on="from", right_on="id")
    df = df.rename(columns={"x": "from_lng", "y": "from_lat"})
    df = df.merge(nodes_df, left_on="to", right_on="id")
    df = df.rename(columns={"x": "to_lng", "y": "to_lat"})

    keep_columns_named = [
        "from",
        "to",
        "distance",
        "name",
        "highway",
        "service",
        "bridge",
        "tunnel",
        "access",
        "from_lat",
        "from_lng",
        "to_lat",
        "to_lng",
    ]

    df = df.filter(keep_columns_named)

    return df


WHERE = {
    "sf": {
        "ll_min": (37.708052, -122.341117),
        "ll_max": (37.806875, -122.537718),
    },
    "kirkland": {
        "ll_min": (47.7384, -122.1950),
        "ll_max": (47.7118, -122.1654),
    },
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--nocache",
        action="store_true",
        help="Download SRTM data; even if a cache is available on local disk",
    )
    parser.add_argument(
        "where", choices=["kirkland", "sf"], help="Specify the location to download."
    )
    args = parser.parse_args()

    write_data_path = os.path.join("/tmp", args.where)
    os.makedirs(write_data_path, exist_ok=True)

    nodes_df, edges_df = get_cached_edges_nodes(write_data_path)

    ll_min = WHERE[args.where]["ll_min"]
    ll_max = WHERE[args.where]["ll_max"]
    print(
        f"Gathering dataset from {args.where}. min={ll_min} max={ll_max}. Those are about {distance(ll_min, ll_max)} apart. "
    )

    if args.nocache or edges_df.empty or nodes_df.empty:
        print("Get network")
        nodes_df, edges_df = osmnet.network_from_bbox(
            lat_min=ll_min[0], lng_min=ll_min[1], lat_max=ll_max[0], lng_max=ll_max[1]
        )
        edges_path = os.path.join(write_data_path, "osmnet_edges.csv")
        print(f"Edges to CSV -> {edges_path}")
        edges_df.to_csv(edges_path)

        nodes_path = os.path.join(write_data_path, "osmnet_nodes.csv")
        print(f"Nodes to CSV -> {nodes_path}")
        nodes_df.to_csv(nodes_path)
    else:
        print("cached")

    orig_size = edges_df.size
    edges_df = remove_nonroad_edges(edges_df)
    nonroad_removed_size = edges_df.size
    print(
        f"Eliminated {orig_size-nonroad_removed_size} non-road edges form original total of {orig_size}."
    )

    nodes_df.reset_index()
    edges_df = join_lat_lng(nodes_df, edges_df)

    out_filename = os.path.join(write_data_path, "edges_with_coordinates.csv")
    print(f"Edges with lat/lng to CSV -> {out_filename}")
    edges_df.to_csv(out_filename)


if __name__ == "__main__":
    main()
